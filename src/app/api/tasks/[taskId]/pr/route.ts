import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: "Неавторизовано" }, { status: 401 });
  }

  const { taskId } = await params;
  const { baseBranch = "main" } = await request.json(); // Цільова гілка (дефолт: main)

  try {
    // 1. Отримуємо задачу, назву гілки та токен доступу
    const task = await db.task.findUnique({
      where: { id: taskId },
      include: {
        project: {
          include: {
            members: {
              include: {
                user: {
                  include: { accounts: { where: { provider: "github" } } },
                },
              },
            },
          },
        },
      },
    });

    if (!task || !task.project) {
      return NextResponse.json({ error: "Задачу або проєкт не знайдено" }, { status: 404 });
    }

    const repoFullName = task.project.repoFullName;
    const branchName = task.branchName;

    if (!repoFullName) {
      return NextResponse.json({ error: "До проєкту не прив'язано репозиторій" }, { status: 400 });
    }

    if (!branchName) {
      return NextResponse.json({ error: "Для цієї задачі ще не створено гілку Git" }, { status: 400 });
    }

    // Шукаємо токен адміністратора або учасника
    const memberWithToken = task.project.members.find(
      (m) => m.user.accounts[0]?.access_token
    );
    const token = memberWithToken?.user.accounts[0]?.access_token;

    if (!token) {
      return NextResponse.json({ error: "Не знайдено токен доступу до GitHub" }, { status: 400 });
    }

    // 2. Надсилаємо запит до GitHub на створення Pull Request
    const prRes = await fetch(`https://api.github.com/repos/${repoFullName}/pulls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "TaskFlow-App",
        "Content-Type": "application/json",
        Accept: "application/vnd.github+json",
      },
      body: JSON.stringify({
        title: `feat: ${task.title}`, // Назва PR
        head: branchName,            // Гілка з вашим кодом
        base: baseBranch,            // Гілка, куди зливаємо (main)
        body: task.description || `Автоматично створено через TaskFlow Pro для задачі: ${task.title}`,
      }),
    });

    const prData = await prRes.json();

    if (!prRes.ok) {
        console.error("GitHub PR Error Details:", JSON.stringify(prData, null, 2));
      // Якщо PR вже існує, GitHub повертає помилку 422
      if (prRes.status === 422 && prData.errors?.[0]?.message?.includes("A pull request already exists")) {
        // Спробуємо знайти лінк на вже існуючий PR
        const existingPrsRes = await fetch(
          `https://api.github.com/repos/${repoFullName}/pulls?head=${repoFullName.split('/')[0]}:${branchName}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "User-Agent": "TaskFlow-App",
            }
          }
        );
        if (existingPrsRes.ok) {
          const prs = await existingPrsRes.json();
          if (prs[0]?.html_url) {
            // Оновлюємо лінк у базі
            await db.task.update({
              where: { id: taskId },
              data: { prUrl: prs[0].html_url },
            });
            return NextResponse.json({ success: true, prUrl: prs[0].html_url, alreadyExists: true });
          }
        }
      }
      return NextResponse.json(
        { error: `Помилка створення PR на GitHub: ${prData.message || "Unknown error"}` },
        { status: prRes.status }
      );
    }

    // 3. Зберігаємо посилання на створений PR у базу даних
    const prUrl = prData.html_url;
    await db.task.update({
      where: { id: taskId },
      data: { prUrl },
    });

    return NextResponse.json({ success: true, prUrl });
  } catch (error) {
    console.error("Помилка створення PR:", error);
    return NextResponse.json({ error: "Внутрішня помилка сервера" }, { status: 500 });
  }
}