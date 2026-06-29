// app/api/projects/route.ts

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

async function autoSetupGithubWebhook(repoFullName: string, token: string, userGithubName: string) {
    // repoFullName приходить у форматі "owner/repo"
    const owner = repoFullName.split('/')[0];

    // Якщо власник не збігається з поточним користувачем (це організація)
    if (owner.toLowerCase() !== userGithubName.toLowerCase()) {
        console.log(`Пропуск автоналаштування: ${repoFullName} належить організації ${owner}. Налаштуйте вебхук вручну.`);
        return;
    }

    const appUrl = process.env.WEBHOOK_APP_URL || process.env.NEXTAUTH_URL;
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

    if (!appUrl || !webhookSecret) {
        console.warn("Пропущено автоналаштування вебхука: відсутні змінні оточення");
        return;
    }

    const webhookUrl = `${appUrl.replace(/\/$/, "")}/api/webhooks/github`;

    try {
        const res = await fetch(`https://api.github.com/repos/${repoFullName}/hooks`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "User-Agent": "TaskFlow-App",
                "Content-Type": "application/json",
                Accept: "application/vnd.github+json",
            },
            body: JSON.stringify({
                name: "web",
                active: true,
                events: ["push"],
                config: {
                    url: webhookUrl,
                    content_type: "json",
                    secret: webhookSecret,
                    insecure_ssl: "0",
                },
            }),
        });

        if (!res.ok && res.status !== 422) {
            console.error("Помилка створення вебхука на GitHub:", await res.json());
        }
    } catch (err) {
        console.error("Не вдалося виконати запит автоналаштування вебхука:", err);
    }
}

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

        let sanitizedRepo = null;
        if (repoFullName) {
            sanitizedRepo = repoFullName
                .trim()
                .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "")
                .replace(/^git@github\.com:/i, "")
                .replace(/\.git$/i, "");
        }

        const project = await db.project.create({
            data: {
                name,
                repoFullName: sanitizedRepo,
                members: {
                    create: {
                        // @ts-ignore
                        userId: session.user.id,
                        role: "ADMIN",
                    },
                },
            },
        });

        if (sanitizedRepo) {
            const account = await db.account.findFirst({
                // @ts-ignore
                where: { userId: session.user.id, provider: "github" },
            });
            const userGithubName = session.user.githubUsername;
            if (sanitizedRepo && account?.access_token) {
                await autoSetupGithubWebhook(sanitizedRepo, account.access_token, userGithubName);
            }
        }

        return NextResponse.json(project);
    } catch (error) {
        console.error("Помилка створення проєкту:", error);
        return NextResponse.json({ error: "Помилка сервера" }, { status: 500 });
    }
}