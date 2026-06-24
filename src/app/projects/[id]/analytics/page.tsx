"use client";

import { useSession } from "next-auth/react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";

interface LeaderboardUser {
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

interface CompletedTask {
  id: string;
  title: string;
  description: string | null;
  branchName: string | null;
  timeMs: number;
  commitsCount: number;
  additions: number;
  deletions: number;
  commits: Array<{
    sha: string;
    message: string;
    additions: number;
    deletions: number;
    authorName: string;
    createdAt: string;
  }>;
}

interface AnalyticsData {
  projectName: string;
  repoFullName: string | null;
  summary: {
    totalTasks: number;
    completedTasks: number;
    totalAdditions: number;
    totalDeletions: number;
    totalTimeMs: number;
  };
  leaderboard: LeaderboardUser[];
  completedTasks: CompletedTask[];
}

export default function AnalyticsPage() {
  const { data: session, status: authStatus } = useSession();
  const params = useParams();
  const projectId = params.id as string;

  const [data, setData] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/analytics`);
        if (res.ok) {
          const resData = await res.json();
          setData(resData);
        }
      } catch (err) {
        console.error("Помилка завантаження аналітики", err);
      } finally {
        setIsLoading(false);
      }
    };

    if (session) {
      fetchAnalytics();
    }
  }, [session, projectId]);

  // Форматування мілісекунд у читабельний час
  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${hours}г ${minutes}хв`;
  };

  if (authStatus === "loading" || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 text-gray-900">
        Завантаження аналітики проєкту...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 text-gray-900">
        Не вдалося отримати дані аналітики.
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 pb-16">
      {/* Шапка */}
      <header className="bg-white border-b border-gray-200 py-6 px-8 flex justify-between items-center shadow-sm">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Link href="/" className="hover:underline text-indigo-600">Головна</Link>
            <span>/</span>
            <Link href={`/projects/${projectId}`} className="hover:underline text-indigo-600">Проєкт</Link>
            <span>/</span>
            <span>Аналітика</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">Аналітика: {data.projectName}</h1>
        </div>
        <Link
          href={`/projects/${projectId}`}
          className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded font-semibold transition"
        >
          ← До Kanban-дошки
        </Link>
      </header>

      <div className="max-w-7xl mx-auto p-8 flex flex-col gap-8">

        {/* Блок сумарної статистики */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
            <p className="text-xs font-semibold text-gray-400 uppercase">Закрито задач</p>
            <p className="text-3xl font-extrabold text-gray-800 mt-2">
              {data.summary.completedTasks} <span className="text-sm font-normal text-gray-400">/ {data.summary.totalTasks}</span>
            </p>
          </div>
          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
            <p className="text-xs font-semibold text-gray-400 uppercase">Загальний час роботи</p>
            <p className="text-3xl font-extrabold text-indigo-600 mt-2">{formatTime(data.summary.totalTimeMs)}</p>
          </div>
          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
            <p className="text-xs font-semibold text-gray-400 uppercase">Додано рядків коду</p>
            <p className="text-3xl font-extrabold text-green-600 mt-2">+{data.summary.totalAdditions}</p>
          </div>
          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
            <p className="text-xs font-semibold text-gray-400 uppercase">Видалено рядків коду</p>
            <p className="text-3xl font-extrabold text-red-500 mt-2">-{data.summary.totalDeletions}</p>
          </div>
        </section>

        {/* Блок Leaderboard */}
        <section className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
          <h2 className="text-lg font-bold text-gray-800 mb-6">Внесок учасників команди</h2>
          <div className="overflow-x-auto">
            {/* Таблиця внеску учасників */}
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase">
                  <th className="pb-3">Розробник</th>
                  <th className="pb-3 text-center">Виконано задач</th> {/* ДОДАНО */}
                  <th className="pb-3 text-center">Витрачений час</th>
                  <th className="pb-3 text-center">Комітів</th>
                  <th className="pb-3 text-right">Зміни коду</th>
                </tr>
              </thead>
              <tbody>
                {data.leaderboard.map((user) => (
                  <tr key={user.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition">
                    <td className="py-4 flex items-center gap-3">
                      <img src={user.image} alt={user.name} className="w-9 h-9 rounded-full border" />
                      <div>
                        <p className="font-semibold text-sm text-gray-800">{user.name}</p>
                        <p className="text-xs text-gray-400 font-mono">@{user.githubUsername}</p>
                      </div>
                    </td>
                    {/* ДОДАНО: відображення кількості виконаних задач */}
                    <td className="py-4 text-center font-bold text-sm text-indigo-600">
                      {user.completedTasksCount}
                    </td>
                    <td className="py-4 text-center font-semibold text-sm text-gray-700">
                      {formatTime(user.timeMs)}
                    </td>
                    <td className="py-4 text-center text-sm text-gray-600">
                      {user.commitsCount}
                    </td>
                    <td className="py-4 text-right text-sm font-mono">
                      <span className="text-green-600 font-bold">+{user.additions}</span>
                      <span className="text-gray-300 mx-1.5">/</span>
                      <span className="text-red-500 font-bold">-{user.deletions}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Блок історії та архіву задач */}
        <section className="flex flex-col gap-6">
          <h2 className="text-lg font-bold text-gray-800">Архів виконаних задач ({data.completedTasks.length})</h2>
          {data.completedTasks.length === 0 ? (
            <div className="bg-white p-12 text-center rounded-lg border text-gray-400">
              Тут з'являться ваші закриті задачі, коли ви переведете першу задачу в статус «Завершено».
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {data.completedTasks.map((task) => (
                <div key={task.id} className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm flex flex-col gap-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 pb-3">
                    <div>
                      <h3 className="font-bold text-gray-800">{task.title}</h3>
                      {task.branchName && (
                        <span className="inline-block mt-1 text-[10px] font-mono bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded border border-indigo-100">
                          branch: {task.branchName}
                        </span>
                      )}
                    </div>
                    <div className="text-left sm:text-right text-xs">
                      <p className="font-semibold text-gray-600">Час роботи: <span className="text-indigo-600 font-bold">{formatTime(task.timeMs)}</span></p>
                      <p className="text-gray-400 font-mono mt-0.5">
                        зміни: <span className="text-green-600">+{task.additions}</span> / <span className="text-red-500">-{task.deletions}</span>
                      </p>
                    </div>
                  </div>

                  {/* Список комітів задачі */}
                  <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase mb-2">Зроблені коміти ({task.commitsCount})</h4>
                    {task.commits.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">До цієї задачі ще не прив'язано жодного коміту.</p>
                    ) : (
                      <div className="flex flex-col gap-2 max-h-[180px] overflow-y-auto pr-2">
                        {task.commits.map((commit, idx) => (
                          <div key={idx} className="flex justify-between items-center bg-gray-50 p-2.5 rounded border border-gray-100 text-xs font-mono">
                            <div className="flex items-center gap-2 truncate">
                              <span className="bg-gray-200 px-1.5 py-0.5 rounded font-bold text-gray-600 text-[10px]">{commit.sha}</span>
                              <span className="text-gray-700 truncate font-sans font-medium">{commit.message}</span>
                            </div>
                            <div className="flex items-center gap-3 shrink-0 ml-4">
                              <span className="text-[10px] text-gray-400 font-sans">by {commit.authorName}</span>
                              <div>
                                <span className="text-green-600 font-bold">+{commit.additions}</span>
                                <span className="text-red-500 font-bold ml-1.5">-{commit.deletions}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
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