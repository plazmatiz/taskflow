// app/api/projects/route.ts

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

async function autoSetupGithubWebhook(repoFullName: string, token: string) {
    const webhookUrl = process.env.WEBHOOK_APP_URL;
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

    if (!webhookUrl || !webhookSecret) {
        console.warn("Пропущено автоналаштування вебхука: відсутній WEBHOOK_APP_URL або GITHUB_WEBHOOK_SECRET");
        return;
    }


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

        if (!res.ok) {
            const errData = await res.json();
            if (res.status !== 422) {
                console.error("Помилка створення вебхука на GitHub:", errData);
            }
        } else {
            console.log(`Вебхук успішно створено автоматично для ${repoFullName}`);
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
            if (account?.access_token) {
                await autoSetupGithubWebhook(sanitizedRepo, account.access_token);
            }
        }

        return NextResponse.json(project);
    } catch (error) {
        console.error("Помилка створення проєкту:", error);
        return NextResponse.json({ error: "Помилка сервера" }, { status: 500 });
    }
}