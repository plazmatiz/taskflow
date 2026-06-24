import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// Отримання списку проєктів, у яких користувач є учасником
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: "Неавторизовано" }, { status: 401 });
  }

  try {
    const projects = await db.project.findMany({
      where: {
        members: {
          some: {
            // @ts-ignore
            userId: session.user.id,
          },
        },
      },
      include: {
        _count: {
          select: { tasks: true },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json(projects);
  } catch (error) {
    console.error("Помилка отримання проєктів:", error);
    return NextResponse.json({ error: "Помилка сервера" }, { status: 500 });
  }
}

// Створення нового проєкту
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: "Неавторизовано" }, { status: 401 });
  }

  try {
    const { name, repoFullName } = await request.json();

    if (!name) {
      return NextResponse.json({ error: "Назва проєкту обов'язкова" }, { status: 400 });
    }

    // Створюємо проєкт і додаємо користувача як ADMIN
    const project = await db.project.create({
      data: {
        name,
        repoFullName: repoFullName || null,
        members: {
          create: {
            // @ts-ignore
            userId: session.user.id,
            role: "ADMIN",
          },
        },
      },
    });

    return NextResponse.json(project);
  } catch (error) {
    console.error("Помилка створення проєкту:", error);
    return NextResponse.json({ error: "Помилка сервера" }, { status: 500 });
  }
}