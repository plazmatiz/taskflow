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
                members: { some: { userId: (session.user as any).id } },
            },
            include: {
                members: { include: { user: true } },
            },
        });

        if (!project) return NextResponse.json({ error: "Проєкт не знайдено" }, { status: 404 });
        return NextResponse.json(project);
    } catch (error) {
        return NextResponse.json({ error: "Помилка сервера" }, { status: 500 });
    }
}

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) return NextResponse.json({ error: "Неавторизовано" }, { status: 401 });

    const { id } = await params;
    const { name, repoFullName, cloneCode, isArchived } = await request.json();

    try {
        const project = await db.project.findUnique({
            where: { id },
            include: { members: { include: { user: { include: { accounts: { where: { provider: "github" } } } } } } },
        });

        if (!project) return NextResponse.json({ error: "Проєкт не знайдено" }, { status: 404 });

        const isAdmin = project.members.some((m) => m.userId === (session.user as any).id && m.role === "ADMIN");
        if (!isAdmin) return NextResponse.json({ error: "Тільки адміністратор може редагувати" }, { status: 403 });

        const token = project.members.find((m) => m.user.accounts[0]?.access_token)?.user.accounts[0]?.access_token;
        const oldRepo = project.repoFullName;

        let sanitizedRepo = repoFullName ? repoFullName.trim()
            .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "")
            .replace(/^git@github\.com:/i, "")
            .replace(/\.git$/i, "") : null;

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

        let cloneInstructions = null;

        if (cloneCode && oldRepo && sanitizedRepo && oldRepo !== sanitizedRepo) {
            if (!token) return NextResponse.json({ error: "Немає GitHub токена" }, { status: 400 });

            const oldRepoRes = await fetch(`https://api.github.com/repos/${oldRepo}`, {
                headers: { Authorization: `Bearer ${token}`, "User-Agent": "TaskFlow-App" }
            });
            const isPrivate = oldRepoRes.ok ? (await oldRepoRes.json()).private : true;

            const createRes = await fetch(`https://api.github.com/${newOwner.toLowerCase() === userGithubName.toLowerCase() ? 'user' : 'orgs/' + newOwner}/repos`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "User-Agent": "TaskFlow-App",
                    "Content-Type": "application/json",
                    Accept: "application/vnd.github+json"
                },
                body: JSON.stringify({ name: newRepoName, private: isPrivate }),
            });

            if (!createRes.ok) {
                const errData = await createRes.json();
                if (createRes.status === 403 || createRes.status === 404) {
                    return NextResponse.json({ error: `Немає прав доступу до організації '${newOwner}'. Перевірте налаштування в GitHub (Settings -> Applications).` }, { status: 403 });
                }
                if (createRes.status !== 422) {
                    return NextResponse.json({ error: `Помилка створення репо: ${errData.message}` }, { status: 400 });
                }
            }

            cloneInstructions = `git clone --mirror https://github.com/${oldRepo}.git temp-repo && cd temp-repo && git push --mirror https://github.com/${sanitizedRepo}.git && cd .. && rm -rf temp-repo`;
        }

        const updatedProject = await db.project.update({
            where: { id },
            data: {
                name: name || undefined,
                repoFullName: sanitizedRepo,
                isArchived: isArchived !== undefined ? isArchived : undefined,
            },
        });

        if (sanitizedRepo && token) {
            await autoSetupGithubWebhook(sanitizedRepo, token, userGithubName);
        }

        return NextResponse.json({ project: updatedProject, cloneInstructions });
    } catch (error) {
        console.error("Помилка оновлення проєкту:", error);
        return NextResponse.json({ error: "Помилка сервера" }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) return NextResponse.json({ error: "Неавторизовано" }, { status: 401 });

    const { id } = await params;
    try {
        const member = await db.projectMember.findFirst({
            where: { projectId: id, userId: (session.user as any).id, role: "ADMIN" },
        });

        if (!member) return NextResponse.json({ error: "Тільки ADMIN може видалити" }, { status: 403 });

        await db.project.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: "Помилка видалення" }, { status: 500 });
    }
}