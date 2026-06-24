// app/api/projects/[id]/route.ts

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
    // Цю функцію ми будемо викликати при створенні/зміні репозиторію

    async function autoSetupGithubWebhook(repoFullName: string, token: string) {
        const appUrl = process.env.NEXTAUTH_URL; // Наприклад: https://my-app.vercel.app
        const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

        if (!appUrl || !webhookSecret) {
            console.warn("Пропущено автоналаштування вебхука: відсутній NEXTAUTH_URL або GITHUB_WEBHOOK_SECRET");
            return;
        }

        const webhookUrl = `${appUrl}/api/webhooks/github`;

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
                // Статус 422 означає, що вебхук для цього URL вже існує в репозиторії, це нормально
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

        // Попередній репозиторій
        const oldRepo = project.repoFullName;

        // Очищуємо та розбираємо новий репозиторій
        let sanitizedRepo = repoFullName ? repoFullName.trim()
            .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "")
            .replace(/^git@github\.com:/i, "")
            .replace(/\.git$/i, "") : null;

        // Спроба автоматично визначити власника та назву репозиторію
        // @ts-ignore
        const userGithubName = session.user.githubUsername;
        let newOwner = userGithubName;
        let newRepoName = sanitizedRepo || "";

        if (sanitizedRepo && sanitizedRepo.includes("/")) {
            const parts = sanitizedRepo.split("/");
            newOwner = parts[0];
            newRepoName = parts[1];
        } else if (sanitizedRepo) {
            // Якщо користувач ввів просто назву (напр. "my-new-app"), власником стає сам користувач
            sanitizedRepo = `${newOwner}/${newRepoName}`;
        }

        // 2. Логіка створення та клонування
        if (cloneCode && oldRepo && sanitizedRepo && oldRepo !== sanitizedRepo) {
            // Крок А: Дізнаємося приватність старого репозиторію (копіюємо налаштування)
            const oldRepoRes = await fetch(`https://api.github.com/repos/${oldRepo}`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "User-Agent": "TaskFlow-App",
                    Accept: "application/vnd.github+json",
                },
            });

            let isPrivate = true; // Безпечний дефолт
            if (oldRepoRes.ok) {
                const oldRepoData = await oldRepoRes.ok ? await oldRepoRes.json() : {};
                isPrivate = oldRepoData.private ?? true;
            }

            // Крок Б: Створюємо новий порожній репозиторій на GitHub
            // Якщо власник збігається з логіном юзера — створюємо у його профілі, інакше — в організації
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
                // Якщо помилка не 422 (репозиторій уже існує), зупиняємо процес
                if (createRes.status !== 422) {
                    return NextResponse.json(
                        { error: `Не вдалося створити репозиторій на GitHub: ${errData.message}` },
                        { status: 400 }
                    );
                }
            }

            // Невелика затримка для завершення ініціалізації репозиторію на GitHub
            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Крок В: Запускаємо імпорт коду
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

        // 3. Зберігаємо оновлені дані в локальній БД
        const updatedProject = await db.project.update({
            where: { id },
            data: {
                name: name || undefined,
                repoFullName: sanitizedRepo,
            },
        });

        // АВТОМАТИЗАЦІЯ: Якщо репозиторій змінився або був доданий — реєструємо вебхук
        if (sanitizedRepo && token) {
            await autoSetupGithubWebhook(sanitizedRepo, token);
        }

        return NextResponse.json(updatedProject);
    } catch (error) {
        console.error("Помилка оновлення проєкту:", error);
        return NextResponse.json({ error: "Помилка сервера" }, { status: 500 });
    }
}