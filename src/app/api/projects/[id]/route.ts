import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> } // Типізуємо як Promise
) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: "Неавторизовано" }, { status: 401 });
  }

  const { id } = await params; // Очікуємо отримання параметрів

  try {
    const project = await db.project.findFirst({
      where: {
        id,
        members: {
          some: {
            // @ts-ignore
            userId: session.user.id,
          },
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Проєкт не знайдено або немає доступу" }, { status: 404 });
    }

    return NextResponse.json(project);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Помилка сервера" }, { status: 500 });
  }
}