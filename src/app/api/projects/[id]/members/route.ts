import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: "Неавторизовано" }, { status: 401 });
  }

  const { id: projectId } = await params;
  const { githubUsername } = await request.json();

  if (!githubUsername) {
    return NextResponse.json({ error: "Вкажіть GitHub нікнейм" }, { status: 400 });
  }

  try {
    // 1. Перевіряємо, чи є поточний користувач ADMIN-ом у цьому проєкті
    const currentUserMember = await db.projectMember.findFirst({
      where: {
        projectId,
        // @ts-ignore
        userId: session.user.id,
        role: "ADMIN",
      },
    });

    if (!currentUserMember) {
      return NextResponse.json(
        { error: "Тільки адміністратор проєкту може додавати нових учасників" },
        { status: 403 }
      );
    }

    // 2. Шукаємо цільового користувача в нашій базі даних за GitHub нікнеймом
    const targetUser = await db.user.findUnique({
      where: { githubUsername: githubUsername.trim() },
    });

    if (!targetUser) {
      return NextResponse.json(
        { 
          error: "Користувача з таким нікнеймом не знайдено. Переконайтеся, що він хоча б один раз увійшов у додаток через GitHub, щоб його профіль створився в базі." 
        },
        { status: 404 }
      );
    }

    // 3. Перевіряємо, чи він вже не доданий до проєкту
    const existingMember = await db.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId: targetUser.id,
        },
      },
    });

    if (existingMember) {
      return NextResponse.json({ error: "Цей користувач вже є учасником проєкту" }, { status: 400 });
    }

    // 4. Додаємо користувача до проєкту з роллю MEMBER
    const newMember = await db.projectMember.create({
      data: {
        projectId,
        userId: targetUser.id,
        role: "MEMBER",
      },
      include: {
        user: true,
      },
    });

    return NextResponse.json(newMember);
  } catch (error) {
    console.error("Помилка додавання учасника:", error);
    return NextResponse.json({ error: "Помилка сервера" }, { status: 500 });
  }
}