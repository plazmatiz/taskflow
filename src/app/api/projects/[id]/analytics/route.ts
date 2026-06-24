import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

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
    // 1. Перевіряємо доступ користувача до проєкту
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

    // 2. Отримуємо проєкт з усіма задачами, сесіями та комітами
    const project = await db.project.findUnique({
      where: { id: projectId },
      include: {
        tasks: {
          include: {
            sessions: true,
            commits: {
              include: {
                author: {
                  select: { id: true, name: true, image: true, githubUsername: true },
                },
              },
            },
          },
        },
        members: {
          include: {
            user: {
              select: { id: true, name: true, image: true, githubUsername: true },
            },
          },
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Проєкт не знайдено" }, { status: 404 });
    }

    // 3. Обчислюємо загальну та індивідуальну статистику
    let totalAdditions = 0;
    let totalDeletions = 0;
    let totalTimeMs = 0;
    const completedTasksCount = project.tasks.filter((t) => t.status === "DONE").length;

    // Словник для збереження статистики розробників
    const userStatsMap: Record<
      string,
      {
        id: string;
        name: string;
        image: string;
        githubUsername: string;
        commitsCount: number;
        additions: number;
        deletions: number;
        timeMs: number;
        completedTasksCount: number
      }
    > = {};

    // Ініціалізуємо статистику для всіх учасників проєкту
    project.members.forEach((member) => {
      userStatsMap[member.user.id] = {
        id: member.user.id,
        name: member.user.name || "Користувач",
        image: member.user.image || "",
        githubUsername: member.user.githubUsername || "",
        commitsCount: 0,
        additions: 0,
        deletions: 0,
        timeMs: 0,
        completedTasksCount: 0,
      };
    });

    // Проходимо по кожній задачі проєкту
    project.tasks.forEach((task) => {
      // Рахуємо сумарний час роботи над цією задачею
      let taskTimeMs = 0;
      task.sessions.forEach((s) => {
        const start = new Date(s.startedAt).getTime();
        const end = s.endedAt ? new Date(s.endedAt).getTime() : Date.now();
        taskTimeMs += end - start;
      });

      totalTimeMs += taskTimeMs;

      // Якщо за задачею закріплений виконавець, записуємо час йому
      if (task.assigneeId && userStatsMap[task.assigneeId]) {
        userStatsMap[task.assigneeId].timeMs += taskTimeMs;
      } else if (task.sessions.length > 0) {
        // Альтернатива: якщо виконавця немає, розподіляємо час першому учаснику як спрощений варіант
        const firstMember = project.members[0];
        if (firstMember) {
          userStatsMap[firstMember.user.id].timeMs += taskTimeMs;
        }
      }

      // Рахуємо統計 по комітах
      task.commits.forEach((commit) => {
        totalAdditions += commit.additions;
        totalDeletions += commit.deletions;

        if (commit.authorId && userStatsMap[commit.authorId]) {
          userStatsMap[commit.authorId].commitsCount += 1;
          userStatsMap[commit.authorId].additions += commit.additions;
          userStatsMap[commit.authorId].deletions += commit.deletions;
        }
      });
    });

    // Формуємо масив виконаних задач з деталями для історії
    const completedTasksList = project.tasks
      .filter((t) => t.status === "DONE")
      .map((t) => {
        let taskTimeMs = 0;
        t.sessions.forEach((s) => {
          const start = new Date(s.startedAt).getTime();
          const end = s.endedAt ? new Date(s.endedAt).getTime() : Date.now();
          taskTimeMs += end - start;
        });

        const taskAdditions = t.commits.reduce((sum, c) => sum + c.additions, 0);
        const taskDeletions = t.commits.reduce((sum, c) => sum + c.deletions, 0);

        return {
          id: t.id,
          title: t.title,
          description: t.description,
          branchName: t.branchName,
          timeMs: taskTimeMs,
          commitsCount: t.commits.length,
          additions: taskAdditions,
          deletions: taskDeletions,
          commits: t.commits.map((c) => ({
            sha: c.sha.slice(0, 7),
            message: c.message,
            additions: c.additions,
            deletions: c.deletions,
            authorName: c.author?.name || c.author?.githubUsername || "Unknown",
            createdAt: c.createdAt,
          })),
        };
      });

    return NextResponse.json({
      projectName: project.name,
      repoFullName: project.repoFullName,
      summary: {
        totalTasks: project.tasks.length,
        completedTasks: completedTasksCount,
        totalAdditions,
        totalDeletions,
        totalTimeMs,
      },
      leaderboard: Object.values(userStatsMap).sort((a, b) => b.timeMs - a.timeMs),
      completedTasks: completedTasksList,
    });
  } catch (error) {
    console.error("Помилка отримання аналітики:", error);
    return NextResponse.json({ error: "Помилка сервера" }, { status: 500 });
  }
}