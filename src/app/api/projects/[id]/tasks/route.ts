import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// Отримання списку задач проєкту
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: "Неавторизовано" }, { status: 401 });
  }

  const { id: projectId } = await params;

  try {
    const isMember = await db.projectMember.findFirst({
      where: {
        projectId,
        // @ts-ignore
        userId: session.user.id,
      },
    });

    if (!isMember) {
      return NextResponse.json({ error: "Немає доступу до проєкту" }, { status: 403 });
    }

    const tasks = await db.task.findMany({
      where: { projectId },
      include: {
        sessions: true, // ДОДАНО: завантажуємо сесії для підрахунку часу
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(tasks);
  } catch (error) {
    console.error("Помилка отримання задач:", error);
    return NextResponse.json({ error: "Помилка сервера" }, { status: 500 });
  }
}

// Створення нової задачі
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> } // Для Next.js 15
) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: "Неавторизовано" }, { status: 401 });
  }

  const { id: projectId } = await params;
  const { title, description } = await request.json();

  if (!title) {
    return NextResponse.json({ error: "Заголовок обов'язковий" }, { status: 400 });
  }

  try {
    // Перевіряємо доступ
    const isMember = await db.projectMember.findFirst({
      where: {
        projectId,
        // @ts-ignore
        userId: session.user.id,
      },
    });

    if (!isMember) {
      return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
    }

    const task = await db.task.create({
      data: {
        title,
        description: description || null,
        projectId,
        status: "TODO",
      },
    });

    return NextResponse.json(task);
  } catch (error) {
    console.error("Помилка створення задачі:", error);
    return NextResponse.json({ error: "Помилка сервера" }, { status: 500 });
  }
}