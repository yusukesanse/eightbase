"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dayjs from "dayjs";

interface Stats {
  totalUsers: number;
  activeUsers: number;
  totalReservations: number;
  upcomingReservations: number;
  todayReservations: number;
  reservationsThisMonth: number;
}

interface Reservation {
  reservationId: string;
  facilityName: string;
  displayName: string;
  tenantName: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
}

function StatCard({
  label,
  value,
  sub,
  color = "gray",
}: {
  label: string;
  value: number | string;
  sub?: string;
  color?: "gray" | "blue" | "green" | "amber";
}) {
  const colors = {
    gray: "bg-white border-gray-200",
    blue: "bg-blue-50 border-blue-100",
    green: "bg-green-50 border-green-100",
    amber: "bg-amber-50 border-amber-100",
  };
  const valueColors = {
    gray: "text-gray-900",
    blue: "text-blue-700",
    green: "text-green-700",
    amber: "text-amber-700",
  };
  return (
    <div className={`rounded-xl border p-5 ${colors[color]}`}>
      <p className="text-xs font-medium text-gray-500 mb-2">{label}</p>
      <p className={`text-3xl font-bold ${valueColors[color]}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = sessionStorage.getItem("admin_token");
    if (!token) return;

    Promise.all([
      fetch("/api/admin/stats", { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
      fetch("/api/admin/reservations", { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
    ])
      .then(([statsData, resData]) => {
        setStats(statsData);
        // 直近5件（日付が近い今後の予約 or 最新）
        const all: Reservation[] = resData.reservations ?? [];
        const today = dayjs().format("YYYY-MM-DD");
        const upcoming = all.filter((r) => r.date >= today).sort((a, b) => a.date.localeCompare(b.date));
        setRecent(upcoming.slice(0, 8));
        setLoading(false);
      })
      .catch(() => {
        setError("データの取得に失敗しました");
        setLoading(false);
      });
  }, []);

  const today = dayjs().format("YYYY年M月D日");

  return (
    <div className="p-8">
      {/* ヘッダー */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900">ダッシュボード</h2>
        <p className="text-sm text-gray-400 mt-1">{today} の状況</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-600">{error}</div>
      ) : (
        <>
          {/* 統計カード */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            <StatCard label="登録ユーザー数" value={stats?.totalUsers ?? 0} sub={`有効: ${stats?.activeUsers ?? 0} 名`} color="gray" />
            <StatCard label="今日の予約" value={stats?.todayReservations ?? 0} sub="件" color="blue" />
            <StatCard label="今後の予約" value={stats?.upcomingReservations ?? 0} sub="件（今日以降）" color="green" />
            <StatCard label="今月の予約" value={stats?.reservationsThisMonth ?? 0} sub="件" color="amber" />
            <StatCard label="累計予約数" value={stats?.totalReservations ?? 0} sub="件" color="gray" />
            <div className="rounded-xl border border-gray-200 bg-white p-5 flex flex-col justify-between">
              <p className="text-xs font-medium text-gray-500 mb-2">クイックアクション</p>
              <div className="space-y-2">
                <Link
                  href="/admin/users"
                  className="block text-center py-2 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors"
                >
                  ユーザーを追加
                </Link>
                <Link
                  href="/admin/reservations"
                  className="block text-center py-2 text-xs font-medium border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  予約一覧を見る
                </Link>
              </div>
            </div>
          </div>

          {/* 直近の予約 */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">今後の予約（直近8件）</h3>
              <Link href="/admin/reservations" className="text-xs text-blue-600 hover:underline">
                すべて見る →
              </Link>
            </div>
            {recent.length === 0 ? (
              <div className="px-6 py-10 text-center text-sm text-gray-400">
                今後の予約はありません
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500">日時</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500">施設</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500">予約者</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500">テナント</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r, i) => (
                    <tr
                      key={r.reservationId}
                      className={`border-b border-gray-50 hover:bg-gray-50 transition-colors ${i % 2 === 0 ? "" : "bg-gray-50/50"}`}
                    >
                      <td className="px-6 py-3 text-gray-700 whitespace-nowrap">
                        <span className="font-medium">{dayjs(r.date).format("M/D")}</span>
                        <span className="text-gray-400 ml-2 text-xs">{r.startTime}〜{r.endTime}</span>
                      </td>
                      <td className="px-6 py-3 text-gray-600">{r.facilityName}</td>
                      <td className="px-6 py-3 text-gray-800 font-medium">{r.displayName}</td>
                      <td className="px-6 py-3 text-gray-500">{r.tenantName || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
