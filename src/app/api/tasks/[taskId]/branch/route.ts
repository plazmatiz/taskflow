import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// Функція для створення безпечної назви гілки (транслітерація або ASCII)
function generateBranchName(title: string, taskId: string) {
  const shortId = taskId.slice(-6); // Беремо останні 6 символів CUID
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // Замінюємо всі не-ASCII символи на дефіс
    .replace(/(^-|-$)+/g, ""); // Видаляємо дефіси на початку та в кінці
  
  return slug ? `task-${shortId}-${slug}` : `task-${shortId}`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: "Неавторизовано" }, { status: 401 });
  }

  const { taskId } = await params;
  const { baseBranch = "main" } = await request.json(); // Гілка, від якої створюємо (дефолт: main)

  try {
    // 1. Отримуємо задачу, проєкт та токен для роботи з GitHub
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
    if (!repoFullName) {
      return NextResponse.json({ error: "До проєкту не прив'язано репозиторій GitHub" }, { status: 400 });
    }

    // Шукаємо токен будь-якого учасника проєкту для виконання запиту
    const memberWithToken = task.project.members.find(
      (m) => m.user.accounts[0]?.access_token
    );
    const token = memberWithToken?.user.accounts[0]?.access_token;

    if (!token) {
      return NextResponse.json({ error: "Не знайдено токен доступу до GitHub" }, { status: 400 });
    }

    // 2. Генеруємо назву нової гілки
    const newBranchName = generateBranchName(task.title, task.id);

    // 3. Робимо запит до GitHub, щоб отримати SHA останнього коміту базової гілки (main)
    const baseRefRes = await fetch(
      `https://api.github.com/repos/${repoFullName}/git/ref/heads/${baseBranch}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "TaskFlow-App",
          Accept: "application/vnd.github+json",
        },
      }
    );

    if (!baseRefRes.ok) {
      const errorData = await baseRefRes.json();
      return NextResponse.json(
        { error: `Не вдалося отримати базову гілку: ${errorData.message}` },
        { status: baseRefRes.status }
      );
    }

    const baseRefData = await baseRefRes.json();
    const baseSha = baseRefData.object.sha;

    // 4. Створюємо нову гілку в GitHub
    const createBranchRes = await fetch(
      `https://api.github.com/repos/${repoFullName}/git/refs`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "TaskFlow-App",
          "Content-Type": "application/json",
          Accept: "application/vnd.github+json",
        },
        body: JSON.stringify({
          ref: `refs/heads/${newBranchName}`,
          sha: baseSha,
        }),
      }
    );

    if (!createBranchRes.ok) {
      const errorData = await createBranchRes.json();
      // Якщо гілка вже існує, ми можемо просто прив'язати її в БД
      if (createBranchRes.status !== 422) {
        return NextResponse.json(
          { error: `Помилка створення гілки на GitHub: ${errorData.message}` },
          { status: createBranchRes.status }
        );
      }
    }

    // 5. Зберігаємо назву гілки в базі даних для нашої задачі
    await db.task.update({
      where: { id: taskId },
      data: { branchName: newBranchName },
    });

    return NextResponse.json({ success: true, branchName: newBranchName });
  } catch (error) {
    console.error("Помилка автоматизації гілок:", error);
    return NextResponse.json({ error: "Внутрішня помилка сервера" }, { status: 500 });
  }
}