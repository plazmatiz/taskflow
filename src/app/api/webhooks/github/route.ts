// app/api/webhooks/github/route.ts

import { NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

type ProjectWithRelations = Prisma.ProjectGetPayload<{
  include: {
    members: {
      include: {
        user: {
          include: {
            accounts: true;
          };
        };
      };
    };
  };
}>;

function verifySignature(payload: string, signature: string, secret: string) {
  const hmac = crypto.createHmac("sha256", secret);
  const digest = Buffer.from("sha256=" + hmac.update(payload).digest("hex"), "utf8");
  const checksum = Buffer.from(signature, "utf8");
  return crypto.timingSafeEqual(digest, checksum);
}

export async function POST(request: Request) {
  const signature = request.headers.get("x-hub-signature-256");
  const event = request.headers.get("x-github-event");

  if (!signature) {
    return NextResponse.json({ error: "No signature header" }, { status: 401 });
  }

  const rawBody = await request.text();
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET || "";

  if (!verifySignature(rawBody, signature, webhookSecret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (event !== "push") {
    return NextResponse.json({ message: "Event ignored" }, { status: 200 });
  }

  try {
    const payload = JSON.parse(rawBody);
    const repoFullName = payload.repository?.full_name;
    const commits = payload.commits || [];
    const ref = payload.ref; // Наприклад: "refs/heads/task-d39f2s-my-feature"

    if (!repoFullName || commits.length === 0) {
      return NextResponse.json({ message: "No commits found" }, { status: 200 });
    }

    // Визначаємо чисту назву гілки, куди прийшов пуш
    const currentBranchName = ref ? ref.replace("refs/heads/", "") : null;

    const project = (await db.project.findFirst({
      where: { repoFullName },
      include: {
        members: {
          include: {
            user: {
              include: {
                accounts: {
                  where: { provider: "github" },
                },
              },
            },
          },
        },
      },
    })) as ProjectWithRelations | null;

    if (!project) {
      return NextResponse.json({ error: "Project not found in DB" }, { status: 404 });
    }

    const memberWithToken = project.members.find(
      (m) => m.user.accounts[0]?.access_token
    );
    const userAccessToken = memberWithToken?.user.accounts[0]?.access_token;

    const cuidRegex = /\b(c[a-z0-9]{24})\b/i;

    // Спершу спробуємо знайти задачу, за якою закріплена ця гілка в поточному проєкті
    let taskByBranchId: string | null = null;
    if (currentBranchName) {
      const taskWithBranch = await db.task.findFirst({
        where: {
          projectId: project.id,
          branchName: currentBranchName,
        },
      });
      if (taskWithBranch) {
        taskByBranchId = taskWithBranch.id;
      }
    }

    for (const commit of commits) {
      const message = commit.message;
      const sha = commit.id;
      const authorUsername = commit.author?.username;

      let taskId: string | null = null;

      // Алгоритм визначення задачі:
      // 1. Пріоритет: чи прив'язана сама гілка до конкретної задачі?
      if (taskByBranchId) {
        taskId = taskByBranchId;
      } else {
        // 2. Альтернатива: шукаємо CUID безпосередньо в повідомленні коміту
        const match = message.match(cuidRegex);
        if (match) {
          const matchedTaskId = match[1];
          // Перевіряємо, чи існує така задача
          const taskExists = await db.task.findUnique({ where: { id: matchedTaskId } });
          if (taskExists) {
            taskId = matchedTaskId;
          }
        }
      }

      // Якщо задачу не вдалося визначити жодним методом — пропускаємо коміт
      if (!taskId) continue;

      let userId: string | null = null;
      if (authorUsername) {
        const user = await db.user.findUnique({
          where: { githubUsername: authorUsername },
        });
        if (user) userId = user.id;
      }

      let additions = 0;
      let deletions = 0;

      if (userAccessToken) {
        try {
          const statsRes = await fetch(
            `https://api.github.com/repos/${repoFullName}/commits/${sha}`,
            {
              headers: {
                Authorization: `Bearer ${userAccessToken}`,
                "User-Agent": "TaskFlow-App",
                Accept: "application/vnd.github+json",
              },
            }
          );

          if (statsRes.ok) {
            const statsData = await statsRes.json();
            additions = statsData.stats?.additions || 0;
            deletions = statsData.stats?.deletions || 0;
          }
        } catch (apiErr) {
          console.error(`Помилка запиту лінійок коду для ${sha}:`, apiErr);
        }
      }

      await db.commit.upsert({
        where: { sha },
        create: {
          sha,
          message,
          additions,
          deletions,
          taskId,
          authorId: userId,
          createdAt: new Date(commit.timestamp),
        },
        update: {
          message,
          additions,
          deletions,
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Помилка обробки вебхука:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}