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
    const ref = payload.ref; 

    // ДІАГНОСТИКА: Логуємо вхідні дані вебхука
    console.log("--- WEBHOOK DIAGNOSTICS START ---");
    console.log("Repo Full Name:", repoFullName);
    console.log("Ref:", ref);
    console.log("Commits received count:", commits.length);

    if (!repoFullName || commits.length === 0) {
      console.log("Skipping: No repo name or empty commits array");
      return NextResponse.json({ message: "No commits found" }, { status: 200 });
    }

    const currentBranchName = ref ? ref.replace("refs/heads/", "") : null;
    console.log("Current Branch Name:", currentBranchName);

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
      console.log("CRITICAL: Project NOT found in database for repo:", repoFullName);
      return NextResponse.json({ error: "Project not found in DB" }, { status: 404 });
    }

    console.log("Database Project Found:", project.name, "ID:", project.id);

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
        console.log("SUCCESS: Task found by branch name mapping. Task ID:", taskByBranchId);
      } else {
        console.log(`WARNING: No task found with branchName = "${currentBranchName}" in project ${project.name}`);
      }
    }

    const memberWithToken = project.members.find(
      (m) => m.user.accounts[0]?.access_token
    );
    const userAccessToken = memberWithToken?.user.accounts[0]?.access_token;
    console.log("User access token resolved:", !!userAccessToken);

    const cuidRegex = /\b(c[a-z0-9]{24})\b/i;

    for (const commit of commits) {
      const message = commit.message;
      const sha = commit.id;
      const authorUsername = commit.author?.username;

      console.log(`Processing commit ${sha.slice(0, 7)}: "${message}" by @${authorUsername}`);

      let taskId: string | null = null;

      if (taskByBranchId) {
        taskId = taskByBranchId;
      } else {
        const match = message.match(cuidRegex);
        if (match) {
          const matchedTaskId = match[1];
          const taskExists = await db.task.findUnique({ where: { id: matchedTaskId } });
          if (taskExists) {
            taskId = matchedTaskId;
            console.log(`Fallback mapping: Found Task CUID in commit message: ${taskId}`);
          }
        }
      }

      if (!taskId) {
        console.log(`SKIP COMMIT: No task mapped for commit ${sha.slice(0, 7)}. Skipping.`);
        continue;
      }

      let userId: string | null = null;
      if (authorUsername) {
        const user = await db.user.findUnique({
          where: { githubUsername: authorUsername },
        });
        if (user) {
          userId = user.id;
          console.log(`Mapped author @${authorUsername} to Database User ID: ${userId}`);
        } else {
          console.log(`Warning: Commit author @${authorUsername} not found in Database Users table`);
        }
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
            console.log(`Lines stats for ${sha.slice(0, 7)}: +${additions} / -${deletions}`);
          } else {
            console.log(`Warning: GitHub stats API returned status ${statsRes.status} for commit ${sha.slice(0, 7)}`);
          }
        } catch (apiErr) {
          console.error(`Error requesting GitHub stats for ${sha.slice(0, 7)}:`, apiErr);
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
      console.log(`SUCCESSFULLY SAVED COMMIT: ${sha.slice(0, 7)} linked to Task: ${taskId}`);
    }

    console.log("--- WEBHOOK DIAGNOSTICS END ---");
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Помилка обробки вебхука:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}