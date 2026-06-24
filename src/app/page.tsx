"use client";

import Link from "next/link";
import { signIn, signOut, useSession } from "next-auth/react";
import { useEffect, useState } from "react";

interface Project {
  id: string;
  name: string;
  repoFullName: string | null;
  _count: {
    tasks: number;
  };
}

export default function Home() {
  const { data: session, status } = useSession();
  const [projects, setProjects] = useState<Project[]>([]);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectRepo, setNewProjectRepo] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Завантаження проєктів з API
  const fetchProjects = async () => {
    try {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const data = await res.json();
        setProjects(data);
      }
    } catch (err) {
      console.error("Не вдалося завантажити проєкти", err);
    }
  };

  useEffect(() => {
    if (session) {
      fetchProjects();
    }
  }, [session]);

  // Обробка створення нового проєкту
  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;

    setIsLoading(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newProjectName,
          repoFullName: newProjectRepo.trim() || null,
        }),
      });

      if (res.ok) {
        setNewProjectName("");
        setNewProjectRepo("");
        fetchProjects(); // Оновлюємо список
      } else {
        alert("Помилка під час створення проєкту");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 text-gray-900">
        Завантаження...
      </div>
    );
  }

  // Якщо користувач не авторизований
  if (!session) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-24 bg-gray-50 text-gray-900">
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full text-center border border-gray-100">
          <h1 className="text-3xl font-bold mb-2">TaskFlow Pro</h1>
          <p className="text-gray-500 mb-6">Увійдіть для роботи з вашими проєктами</p>
          <button
            onClick={() => signIn("github")}
            className="px-6 py-3 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition font-medium inline-flex items-center gap-2 justify-center w-full"
          >
            Увійти через GitHub
          </button>
        </div>
      </main>
    );
  }

  // Якщо авторизований (Головний Dashboard)
  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      {/* Навігаційна панель */}
      <header className="bg-white border-b border-gray-200 py-4 px-8 flex justify-between items-center">
        <h1 className="text-xl font-bold text-gray-800">TaskFlow Pro Dashboard</h1>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-sm font-semibold">{session.user?.name}</p>
            <p className="text-xs text-gray-500">{(session.user as any).githubUsername}</p>
          </div>
          <img
            src={session.user?.image || ""}
            alt="Avatar"
            className="w-10 h-10 rounded-full border"
          />
          <button
            onClick={() => signOut()}
            className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded text-gray-700 transition"
          >
            Вийти
          </button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto p-8 grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Форма створення проєкту */}
        <section className="bg-white p-6 rounded-lg border border-gray-200 h-fit shadow-sm">
          <h2 className="text-lg font-bold mb-4">Створити проєкт</h2>
          <form onSubmit={handleCreateProject} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                Назва проєкту
              </label>
              <input
                type="text"
                required
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Напр. Мій Стартап"
                className="w-full px-3 py-2 border rounded text-sm focus:outline-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                GitHub репозиторій (необов'язково)
              </label>
              <input
                type="text"
                value={newProjectRepo}
                onChange={(e) => setNewProjectRepo(e.target.value)}
                placeholder="owner/repository"
                className="w-full px-3 py-2 border rounded text-sm focus:outline-indigo-500"
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-semibold transition disabled:opacity-50"
            >
              {isLoading ? "Створення..." : "Зберегти проєкт"}
            </button>
          </form>
        </section>

        {/* Список проєктів */}
        <section className="md:col-span-2">
          <h2 className="text-lg font-bold mb-4">Ваші проєкти</h2>
          {projects.length === 0 ? (
            <div className="bg-white border rounded-lg p-12 text-center text-gray-500">
              У вас поки немає створених проєктів. Використайте форму ліворуч, щоб створити перший.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm hover:border-indigo-300 transition flex flex-col justify-between"
                >
                  <div>
                    <h3 className="font-bold text-lg text-gray-800">{project.name}</h3>
                    {project.repoFullName && (
                      <p className="text-xs text-gray-400 font-mono mt-1">
                        GitHub: {project.repoFullName}
                      </p>
                    )}
                  </div>
                  <div className="mt-6 pt-4 border-t border-gray-100 flex justify-between items-center text-sm">
                    <span className="text-gray-500">
                      Задач у проєкті: <strong>{project._count.tasks}</strong>
                    </span>
                    <Link 
  href={`/projects/${project.id}`}
  className="text-indigo-600 hover:text-indigo-800 font-semibold"
>
  Відкрити →
</Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}