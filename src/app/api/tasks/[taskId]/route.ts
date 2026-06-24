import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: "Неавторизовано" }, { status: 401 });
  }

  const { taskId } = await params;
  const { action } = await request.json(); // Очікуємо "START" | "PAUSE" | "DONE"

  try {
    // Перевіряємо існування задачі та права доступу користувача до проєкту
    const task = await db.task.findUnique({
      where: { id: taskId },
      include: {
        project: {
          include: { members: true },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Задачу не знайдено" }, { status: 404 });
    }

    const isMember = task.project.members.some(
      // @ts-ignore
      (m) => m.userId === session.user.id
    );

    if (!isMember) {
      return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
    }

    const now = new Date();

    if (action === "START") {
      // 1. Про всяк випадок закриваємо незавершені сесії цієї задачі
      await db.taskSession.updateMany({
        where: { taskId, endedAt: null },
        data: { endedAt: now },
      });

      // 2. Створюємо нову активну сесію
      await db.taskSession.create({
        data: {
          taskId,
          startedAt: now,
        },
      });

      // 3. Переводимо статус в IN_PROGRESS
      await db.task.update({
        where: { id: taskId },
        data: { status: "IN_PROGRESS" },
      });

    } else if (action === "PAUSE") {
      // 1. Закриваємо активну сесію (записуємо endedAt)
      await db.taskSession.updateMany({
        where: { taskId, endedAt: null },
        data: { endedAt: now },
      });

      // 2. Переводимо статус назад у TODO
      await db.task.update({
        where: { id: taskId },
        data: { status: "TODO" },
      });

    } else if (action === "DONE") {
      // 1. Якщо була активна сесія — закриваємо її
      await db.taskSession.updateMany({
        where: { taskId, endedAt: null },
        data: { endedAt: now },
      });

      // 2. Встановлюємо статус DONE
      await db.task.update({
        where: { id: taskId },
        data: { status: "DONE" },
      });
    } else {
      return NextResponse.json({ error: "Невідома дія" }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Помилка оновлення задачі:", error);
    return NextResponse.json({ error: "Помилка сервера" }, { status: 500 });
  }
}