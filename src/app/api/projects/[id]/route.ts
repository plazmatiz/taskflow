// app/api/projects/[id]/route.ts

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// Винесено на рівень модуля для чистоти та оптимізації пам'яті
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

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
        return NextResponse.json({ error: "Неавторизовано" }, { status: 401 });
    }

    const { id } = await params;

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
            return NextResponse.json({ error: "Проєкт не знайдено" }, { status: 404 });
        }

        return NextResponse.json(project);
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Помилка сервера" }, { status: 500 });
    }
}

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
        return NextResponse.json({ error: "Неавторизовано" }, { status: 401 });
    }

    const { id } = await params;
    const { name, repoFullName, cloneCode } = await request.json();

    try {
        // 1. Отримуємо дані про проєкт та токен користувача
        const project = await db.project.findUnique({
            where: { id },
            include: {
                members: {
                    include: {
                        user: {
                            include: { accounts: { where: { provider: "github" } } },
                        },
                    },
                },
            },
        });

        if (!project) {
            return NextResponse.json({ error: "Проєкт не знайдено" }, { status: 404 });
        }

        const isAdmin = project.members.some(
            // @ts-ignore
            (m) => m.userId === session.user.id && m.role === "ADMIN"
        );

        if (!isAdmin) {
            return NextResponse.json({ error: "Тільки адміністратор може редагувати проєкт" }, { status: 403 });
        }

        const memberWithToken = project.members.find(
            (m) => m.user.accounts[0]?.access_token
        );
        const token = memberWithToken?.user.accounts[0]?.access_token;

        if (cloneCode && !token) {
            return NextResponse.json({ error: "Не знайдено токен доступу до GitHub для створення та клонування" }, { status: 400 });
        }

        const oldRepo = project.repoFullName;

        let sanitizedRepo = repoFullName ? repoFullName.trim()
            .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "")
            .replace(/^git@github\.com:/i, "")
            .replace(/\.git$/i, "") : null;

        // @ts-ignore
        const userGithubName = session.user.githubUsername;
        let newOwner = userGithubName;
        let newRepoName = sanitizedRepo || "";

        if (sanitizedRepo && sanitizedRepo.includes("/")) {
            const parts = sanitizedRepo.split("/");
            newOwner = parts[0];
            newRepoName = parts[1];
        } else if (sanitizedRepo) {
            sanitizedRepo = `${newOwner}/${newRepoName}`;
        }

        // 2. Логіка створення та клонування
        if (cloneCode && oldRepo && sanitizedRepo && oldRepo !== sanitizedRepo) {
            const oldRepoRes = await fetch(`https://api.github.com/repos/${oldRepo}`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "User-Agent": "TaskFlow-App",
                    Accept: "application/vnd.github+json",
                },
            });

            let isPrivate = true;
            if (oldRepoRes.ok) {
                const oldRepoData = await oldRepoRes.json();
                isPrivate = oldRepoData.private ?? true;
            }

            const createUrl =
                newOwner.toLowerCase() === userGithubName.toLowerCase()
                    ? "https://api.github.com/user/repos"
                    : `https://api.github.com/orgs/${newOwner}/repos`;

            const createRes = await fetch(createUrl, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "User-Agent": "TaskFlow-App",
                    "Content-Type": "application/json",
                    Accept: "application/vnd.github+json",
                },
                body: JSON.stringify({
                    name: newRepoName,
                    private: isPrivate,
                    description: `Автоматично створено через TaskFlow Pro з проєкту ${project.name}`,
                }),
            });

            if (!createRes.ok) {
                const errData = await createRes.json();
                if (createRes.status !== 422) {
                    return NextResponse.json(
                        { error: `Не вдалося створити репозиторій на GitHub: ${errData.message}` },
                        { status: 400 }
                    );
                }
            }

            await new Promise((resolve) => setTimeout(resolve, 1000));

            const importRes = await fetch(
                `https://api.github.com/repos/${sanitizedRepo}/import`,
                {
                    method: "PUT",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "User-Agent": "TaskFlow-App",
                        "Content-Type": "application/json",
                        Accept: "application/vnd.github+json",
                    },
                    body: JSON.stringify({
                        vcs: "git",
                        vcs_url: `https://github.com/${oldRepo}.git`,
                        vcs_username: "oauth2",
                        vcs_password: token,
                    }),
                }
            );

            if (!importRes.ok) {
                const errData = await importRes.json();
                console.error("GitHub Importer Error:", errData);
                return NextResponse.json(
                    { error: `Репозиторій створено, але не вдалося запустити імпорт коду: ${errData.message}` },
                    { status: 400 }
                );
            }
        }

        const updatedProject = await db.project.update({
            where: { id },
            data: {
                name: name || undefined,
                repoFullName: sanitizedRepo,
            },
        });

        if (sanitizedRepo && token) {
            await autoSetupGithubWebhook(sanitizedRepo, token);
        }

        return NextResponse.json(updatedProject);
    } catch (error) {
        console.error("Помилка оновлення проєкту:", error);
        return NextResponse.json({ error: "Помилка сервера" }, { status: 500 });
    }
}