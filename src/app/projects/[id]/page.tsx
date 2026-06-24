// app/projects/[id]/page.tsx

"use client";

import { useSession } from "next-auth/react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";

interface TaskSession {
  id: string;
  startedAt: string;
  endedAt: string | null;
}

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: string;
  branchName: string | null;
  sessions: TaskSession[];
}

interface Project {
  id: string;
  name: string;
  repoFullName: string | null;
}

export default function ProjectPage() {
  const { data: session, status: authStatus } = useSession();
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDesc, setTaskDesc] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Стан для редагування налаштувань проєкту
  const [editName, setEditName] = useState("");
  const [editRepo, setEditRepo] = useState("");
  const [isUpdatingProject, setIsUpdatingProject] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [cloneCode, setCloneCode] = useState(false);

  // Стан для примусового оновлення інтерфейсу кожну секунду (для таймерів)
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Завантаження даних про проєкт та задачі
  const fetchProjectDetails = async () => {
    try {
      const projectRes = await fetch(`/api/projects/${projectId}`);
      if (projectRes.ok) {
        const projectData = await projectRes.json();
        setProject(projectData);
        setEditName(projectData.name);
        setEditRepo(projectData.repoFullName || "");
      }

      const tasksRes = await fetch(`/api/projects/${projectId}/tasks`);
      const tasksData = await tasksRes.json();

      if (tasksRes.ok && Array.isArray(tasksData)) {
        setTasks(tasksData);
      } else {
        setTasks([]);
      }
    } catch (err) {
      console.error("Помилка завантаження деталей проекту:", err);
      setTasks([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (session) {
      fetchProjectDetails();
    }
  }, [session, projectId]);

  // Створення нової задачі
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;

    setIsCreating(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: taskTitle,
          description: taskDesc.trim() || null,
        }),
      });

      if (res.ok) {
        setTaskTitle("");
        setTaskDesc("");
        fetchProjectDetails(); // Оновлюємо таски
      } else {
        alert("Помилка при створенні задачі");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsCreating(false);
    }
  };

  // Керування сесіями задач (Старт / Пауза / Готово)
  const handleTaskAction = async (taskId: string, action: "START" | "PAUSE" | "DONE") => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      if (res.ok) {
        fetchProjectDetails();
      } else {
        alert("Не вдалося оновити стан задачі");
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Створення гілки на GitHub
  const handleCreateBranch = async (taskId: string) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/branch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseBranch: "main" }),
      });

      if (res.ok) {
        const data = await res.json();
        alert(`Гілку створено на GitHub: ${data.branchName}`);
        fetchProjectDetails();
      } else {
        const errData = await res.json();
        alert(`Помилка створення гілки: ${errData.error}`);
      }
    } catch (err) {
      console.error("Помилка створення гілки:", err);
    }
  };

  // Збереження оновлених налаштувань проєкту (та за потреби імпорт коду)
  const handleUpdateProjectSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsUpdatingProject(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          repoFullName: editRepo,
          cloneCode: cloneCode,
        }),
      });

      if (res.ok) {
        alert(
          cloneCode
            ? "Проєкт оновлено. GitHub розпочав імпорт вашого коду у фоновому режимі!"
            : "Налаштування проєкту успішно оновлено."
        );
        setShowSettings(false);
        setCloneCode(false);
        fetchProjectDetails();
      } else {
        const err = await res.json();
        alert(`Помилка: ${err.error}`);
      }
    } catch (err) {
      console.error("Помилка оновлення налаштувань проєкту:", err);
    } finally {
      setIsUpdatingProject(false);
    }
  };

  // Розрахунок витраченого часу на задачу
  const calculateDuration = (sessions: TaskSession[]) => {
    let totalMs = 0;
    sessions.forEach((s) => {
      const start = new Date(s.startedAt).getTime();
      const end = s.endedAt ? new Date(s.endedAt).getTime() : Date.now();
      totalMs += end - start;
    });

    const totalSeconds = Math.floor(totalMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) return `${hours}г ${minutes}хв`;
    if (minutes > 0) return `${minutes}хв ${seconds}с`;
    return `${seconds}с`;
  };

  const isTimerRunning = (sessions: TaskSession[]) => {
    return sessions.some((s) => s.endedAt === null);
  };

  if (authStatus === "loading" || isLoading || !project) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 text-gray-900">
        Завантаження проєкту...
      </div>
    );
  }

  const todoTasks = tasks.filter((t) => t.status === "TODO");
  const inProgressTasks = tasks.filter((t) => t.status === "IN_PROGRESS");
  const doneTasks = tasks.filter((t) => t.status === "DONE");

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 pb-12">
      {/* Шапка проєкту */}
    {/* Оновлений блок шапки проєкту */}
      <header className="bg-white border-b border-gray-200 py-6 px-8 flex justify-between items-center shadow-sm">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Link href="/" className="hover:underline text-indigo-600">Головна</Link>
            <span>/</span>
            <span>Проєкт</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">{project.name}</h1>
          {project.repoFullName && (
            <p className="text-xs text-gray-400 font-mono mt-0.5">
              Репозиторій: {project.repoFullName}
            </p>
          )}
        </div>
        
        {/* Додано контейнер для двох кнопок */}
        <div className="flex gap-3">
          <Link
            href={`/projects/${projectId}/analytics`}
            className="px-4 py-2 text-sm bg-indigo-50 hover:bg-indigo-100 font-semibold text-indigo-700 border border-indigo-100 rounded transition flex items-center"
          >
            Статистика та Аналітика
          </Link>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="px-4 py-2 text-sm border rounded bg-white hover:bg-gray-50 font-semibold text-gray-700 transition"
          >
            {showSettings ? "Закрити налаштування" : "Налаштування проєкту"}
          </button>
        </div>
      </header>

      {/* Панель налаштувань (ЗАЛИШАЄТЬСЯ БЕЗ ЗМІН) */}
      {showSettings && (
        <div className="max-w-7xl mx-auto px-8 pt-8">
          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
            <h2 className="text-lg font-bold mb-4">Редагувати проєкт</h2>
            <form onSubmit={handleUpdateProjectSettings} className="flex flex-col gap-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                    Назва проєкту
                  </label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3 py-2 border rounded text-sm focus:outline-indigo-500 text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                    GitHub репозиторій
                  </label>
                  <input
                    type="text"
                    value={editRepo}
                    onChange={(e) => setEditRepo(e.target.value)}
                    placeholder="owner/repo"
                    className="w-full px-3 py-2 border rounded text-sm focus:outline-indigo-500 text-gray-900"
                  />
                </div>
              </div>

              {/* Опція автоматичного створення та клонування коду */}
              {project.repoFullName && editRepo && project.repoFullName !== editRepo && (
                <div className="bg-indigo-50/50 p-4 rounded border border-indigo-100 flex items-start gap-3">
                  <input
                    type="checkbox"
                    id="cloneCodeCheckbox"
                    checked={cloneCode}
                    onChange={(e) => setCloneCode(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500 border-gray-300"
                  />
                  <label htmlFor="cloneCodeCheckbox" className="text-xs text-indigo-900 leading-relaxed cursor-pointer select-none">
                    <strong>Автоматично створити новий репозиторій та скопіювати туди код.</strong><br />
                    <span className="text-indigo-700">
                      Система сама створить репозиторій <code className="font-mono bg-indigo-100/60 px-1 py-0.5 rounded text-indigo-800">{editRepo}</code> на GitHub (з тими ж налаштуваннями приватності, що й у старого) та повністю перенесе туди всі ваші гілки, файли й повну історію комітів.
                    </span>
                  </label>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isUpdatingProject}
                  className="py-2 px-6 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-semibold transition disabled:opacity-50"
                >
                  {isUpdatingProject ? "Збереження..." : "Зберегти зміни"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Робочий простір */}
      <div className="max-w-7xl mx-auto p-8 grid grid-cols-1 lg:grid-cols-4 gap-8">

        {/* Форма створення задачі */}
        <section className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm h-fit">
          <h2 className="text-lg font-bold mb-4">Нова задача</h2>
          <form onSubmit={handleCreateTask} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                Назва задачі
              </label>
              <input
                type="text"
                required
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                placeholder="Що потрібно зробити?"
                className="w-full px-3 py-2 border rounded text-sm focus:outline-indigo-500 text-gray-900"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                Опис
              </label>
              <textarea
                value={taskDesc}
                onChange={(e) => setTaskDesc(e.target.value)}
                placeholder="Опишіть деталі задачі..."
                rows={4}
                className="w-full px-3 py-2 border rounded text-sm focus:outline-indigo-500 resize-none text-gray-900"
              />
            </div>
            <button
              type="submit"
              disabled={isCreating}
              className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-semibold transition disabled:opacity-50"
            >
              {isCreating ? "Створення..." : "Додати задачу"}
            </button>
          </form>
        </section>

        {/* Дошка задач (Kanban-стиль) */}
        <section className="lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-6">

          {/* Колонка: TODO */}
          <div className="bg-gray-100/70 p-4 rounded-lg border border-gray-200 flex flex-col gap-4 min-h-[400px]">
            <div className="flex justify-between items-center pb-2 border-b">
              <span className="font-bold text-gray-700">TODO</span>
              <span className="px-2 py-0.5 bg-gray-200 text-gray-700 text-xs rounded-full font-semibold">
                {todoTasks.length}
              </span>
            </div>
            <div className="flex flex-col gap-3">
              {todoTasks.map((task) => (
                <div key={task.id} className="bg-white p-4 rounded border shadow-sm hover:border-indigo-200 transition flex flex-col justify-between min-h-[160px]">
                  <div>
                    <h3 className="font-semibold text-gray-800 text-sm">{task.title}</h3>
                    {task.description && (
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{task.description}</p>
                    )}
                  </div>

                  {/* Інформація про Git гілку */}
                  <div className="mt-3 text-[11px] font-mono bg-gray-50 p-2 rounded border border-gray-100 flex flex-col gap-1">
                    {task.branchName ? (
                      <div className="flex justify-between text-gray-600">
                        <span>git branch:</span>
                        <span className="font-semibold text-indigo-600 select-all">{task.branchName}</span>
                      </div>
                    ) : (
                      <div className="flex justify-between items-center text-gray-400">
                        <span>Гілка відсутня</span>
                        <button
                          onClick={() => handleCreateBranch(task.id)}
                          className="text-[10px] text-indigo-600 hover:underline font-bold"
                        >
                          + Створити гілку
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
                    <span className="text-[11px] text-gray-400 font-medium">Час: {calculateDuration(task.sessions)}</span>
                    <button
                      onClick={() => handleTaskAction(task.id, "START")}
                      className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded text-xs font-semibold transition"
                    >
                      Почати роботу
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Колонка: IN PROGRESS */}
          <div className="bg-blue-50/50 p-4 rounded-lg border border-blue-100 flex flex-col gap-4 min-h-[400px]">
            <div className="flex justify-between items-center pb-2 border-b border-blue-100">
              <span className="font-bold text-blue-800">В РОБОТІ</span>
              <span className="px-2 py-0.5 bg-blue-100 text-blue-800 text-xs rounded-full font-semibold">
                {inProgressTasks.length}
              </span>
            </div>
            <div className="flex flex-col gap-3">
              {inProgressTasks.map((task) => {
                const active = isTimerRunning(task.sessions);
                return (
                  <div key={task.id} className="bg-white p-4 rounded border border-blue-100 shadow-sm flex flex-col justify-between min-h-[180px]">
                    <div>
                      <div className="flex justify-between items-start">
                        <h3 className="font-semibold text-gray-800 text-sm">{task.title}</h3>
                        {active && (
                          <span className="flex h-2 w-2 relative">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                          </span>
                        )}
                      </div>
                      {task.description && (
                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">{task.description}</p>
                      )}
                    </div>

                    {/* Інформація про Git гілку */}
                    <div className="mt-3 text-[11px] font-mono bg-gray-50 p-2 rounded border border-gray-100 flex flex-col gap-1">
                      {task.branchName ? (
                        <div className="flex justify-between text-gray-600">
                          <span>git branch:</span>
                          <span className="font-semibold text-indigo-600 select-all">{task.branchName}</span>
                        </div>
                      ) : (
                        <div className="flex justify-between items-center text-gray-400">
                          <span>Гілка відсутня</span>
                          <button
                            onClick={() => handleCreateBranch(task.id)}
                            className="text-[10px] text-indigo-600 hover:underline font-bold"
                          >
                            + Створити гілку
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="mt-4 pt-3 border-t border-gray-100">
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-[11px] font-bold ${active ? 'text-red-500' : 'text-gray-400'}`}>
                          {active ? "Таймер запущено: " : "На паузі: "} {calculateDuration(task.sessions)}
                        </span>
                      </div>
                      <div className="flex gap-2 justify-end">
                        {active ? (
                          <button
                            onClick={() => handleTaskAction(task.id, "PAUSE")}
                            className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded text-xs font-semibold transition"
                          >
                            Пауза
                          </button>
                        ) : (
                          <button
                            onClick={() => handleTaskAction(task.id, "START")}
                            className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded text-xs font-semibold transition"
                          >
                            Продовжити
                          </button>
                        )}
                        <button
                          onClick={() => handleTaskAction(task.id, "DONE")}
                          className="px-2.5 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold transition"
                        >
                          Завершити
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Колонка: DONE */}
          <div className="bg-green-50/50 p-4 rounded-lg border border-green-100 flex flex-col gap-4 min-h-[400px]">
            <div className="flex justify-between items-center pb-2 border-b border-green-100">
              <span className="font-bold text-green-800">ЗАВЕРШЕНО</span>
              <span className="px-2 py-0.5 bg-green-100 text-green-800 text-xs rounded-full font-semibold">
                {doneTasks.length}
              </span>
            </div>
            <div className="flex flex-col gap-3">
              {doneTasks.map((task) => (
                <div key={task.id} className="bg-white p-4 rounded border border-green-100 shadow-sm opacity-80 flex flex-col justify-between min-h-[140px]">
                  <div>
                    <h3 className="font-semibold text-gray-800 text-sm line-through">{task.title}</h3>
                    {task.description && (
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{task.description}</p>
                    )}
                  </div>

                  {/* Інформація про Git гілку */}
                  {task.branchName && (
                    <div className="mt-2 text-[11px] font-mono bg-gray-50/50 p-1.5 rounded border border-gray-100 flex justify-between text-gray-400">
                      <span>branch:</span>
                      <span className="select-all">{task.branchName}</span>
                    </div>
                  )}

                  <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
                    <span className="text-[11px] text-green-700 font-semibold">Час роботи: {calculateDuration(task.sessions)}</span>
                    <button
                      onClick={() => handleTaskAction(task.id, "START")}
                      className="text-xs text-indigo-600 hover:underline font-semibold"
                    >
                      Повернути в роботу
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </section>
      </div>
    </main>
  );
}