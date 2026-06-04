"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dayjs from "dayjs";
import "dayjs/locale/ja";
import {
  ComposedChart,
  AreaChart,
  BarChart,
  Bar,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  Cell,
  PieChart,
  Pie,
} from "recharts";

dayjs.locale("ja");

/* ── 型定義 ── */

interface Stats {
  totalUsers: number;
  activeUsers: number;
  totalReservations: number;
  upcomingReservations: number;
  todayReservations: number;
  reservationsThisMonth: number;
  dailyData: {
    date: string;
    total: number;
    facilities: Record<string, number>;
  }[];
  facilityIds: string[];
  facilityNames: Record<string, string>;
  userGrowth: { date: string; total: number; newUsers: number }[];
  hourlyDistribution: { hour: string; count: number }[];
  eventRanking: { id: string; title: string; goodCount: number; type: string }[];
  facilityUsage: { name: string; count: number }[];
  totalEvents: number;
  publishedEvents: number;
}

/* ── カラーパレット (高コントラスト) ── */

const FACILITY_COLORS = [
  "#2563eb", "#0d9488", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16",
];
const PIE_COLORS = [
  "#2563eb", "#0d9488", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899",
];

/* ── 共通コンポーネント ── */

function StatCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl bg-white border border-gray-200 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

function MiniKPI({
  label,
  value,
  unit,
  accent,
  icon,
}: {
  label: string;
  value: number | string;
  unit?: string;
  accent?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-4 rounded-xl bg-white border border-gray-200 shadow-sm min-w-0">
      <div className="flex items-center gap-2 mb-2">
        {icon && <span className={`${accent || "text-gray-400"}`}>{icon}</span>}
        <p className="text-xs text-gray-500 font-medium truncate">{label}</p>
      </div>
      <div className="flex items-baseline gap-1">
        <span className={`text-xl sm:text-2xl font-bold ${accent || "text-[#1a1a2e]"}`}>
          {value}
        </span>
        {unit && <span className="text-xs text-gray-400">{unit}</span>}
      </div>
    </div>
  );
}

function ChartHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-4 px-1">
      <h3 className="text-sm font-bold text-[#1a1a2e]">{title}</h3>
      {subtitle && (
        <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
      )}
    </div>
  );
}

/* ── カスタムツールチップ ── */

function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter,
}: {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    color: string;
    dataKey: string;
  }>;
  label?: string;
  labelFormatter?: (label: string) => string;
  valueFormatter?: (value: number, name: string) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-lg bg-[#1a1a2e] text-white shadow-xl px-4 py-3 min-w-[140px]">
      <p className="text-[11px] font-medium text-white/60 mb-1.5">
        {labelFormatter ? labelFormatter(label || "") : label}
      </p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <div
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: p.color }}
            />
            <span className="text-[11px] text-white/70 truncate">{p.name}</span>
          </div>
          <span className="text-[11px] font-bold text-white shrink-0">
            {valueFormatter ? valueFormatter(p.value, p.name) : `${p.value}`}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── メインコンポーネント ── */

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(true);
  const [reviewToggling, setReviewToggling] = useState(false);

  useEffect(() => {
    fetch("/api/admin/stats", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((data) => {
        setStats(data);
        setLoading(false);
      })
      .catch(() => {
        setError("データの取得に失敗しました");
        setLoading(false);
      });

    // 審査モードの状態を取得
    fetch("/api/admin/review-mode", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((data) => {
        setReviewMode(data.reviewMode === true);
        setReviewLoading(false);
      })
      .catch(() => {
        setReviewLoading(false);
      });
  }, []);

  const handleToggleReviewMode = async () => {
    const next = !reviewMode;
    const msg = next
      ? "審査モードをONにしますか？\n未登録ユーザーでもログインできるようになります。"
      : "審査モードをOFFにしますか？\n通常のログイン制限に戻ります。";
    if (!confirm(msg)) return;

    setReviewToggling(true);
    try {
      const res = await fetch("/api/admin/review-mode", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ reviewMode: next }),
      });
      if (res.ok) {
        setReviewMode(next);
      } else {
        alert("審査モードの切り替えに失敗しました");
      }
    } catch {
      alert("通信エラーが発生しました");
    } finally {
      setReviewToggling(false);
    }
  };

  // チャートデータ整形
  const reservationChartData = stats?.dailyData?.map((d) => {
    const entry: Record<string, string | number> = {
      date: d.date,
      total: d.total,
    };
    stats.facilityIds.forEach((fid) => {
      entry[fid] = d.facilities[fid] || 0;
    });
    return entry;
  });

  const today = dayjs().format("YYYY年M月D日（dd）");

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-[1400px]">
      {/* ヘッダー */}
      <div className="mb-6">
        <h2 className="text-xl sm:text-2xl font-bold text-[#1a1a2e]">ダッシュボード</h2>
        <p className="text-sm text-gray-400 mt-1">{today}</p>
      </div>

      {/* 審査モード トグル — UI非表示（API・ロジックは維持） */}
      {false && !reviewLoading && (
        <StatCard className={`p-4 mb-5 ${reviewMode ? "border-amber-300 bg-amber-50" : ""}`}>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-[#1a1a2e]">審査モード</h3>
                {reviewMode && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500 text-white">
                    ON
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                {reviewMode
                  ? "有効: 未登録ユーザーでもログイン可能です"
                  : "無効: 登録済みユーザーのみログイン可能です"}
              </p>
            </div>
            <button
              onClick={handleToggleReviewMode}
              disabled={reviewToggling}
              className={`relative shrink-0 w-12 h-7 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                reviewMode
                  ? "bg-amber-500 focus:ring-amber-400"
                  : "bg-gray-300 focus:ring-blue-400"
              } ${reviewToggling ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
              aria-label="審査モード切替"
            >
              <span
                className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow-sm transition-transform duration-200 ${
                  reviewMode ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </StatCard>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-[#1a1a2e] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="rounded-xl bg-red-50 border border-red-200 p-5 text-sm text-red-600">
          {error}
        </div>
      ) : (
        <>
          {/* ミニKPI */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
            <MiniKPI label="登録ユーザー" value={stats?.totalUsers ?? 0} unit="名" accent="text-[#1a1a2e]" />
            <MiniKPI label="今日の予約" value={stats?.todayReservations ?? 0} unit="件" accent="text-blue-600" />
            <MiniKPI label="今後の予約" value={stats?.upcomingReservations ?? 0} unit="件" accent="text-teal-600" />
            <MiniKPI label="今月の予約" value={stats?.reservationsThisMonth ?? 0} unit="件" accent="text-amber-600" />
            <MiniKPI label="累計予約" value={stats?.totalReservations ?? 0} unit="件" accent="text-[#1a1a2e]" />
          </div>

          {/* ── グラフ 2列グリッド ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">

            {/* 1. 予約推移（全幅） */}
            <StatCard className="p-5 sm:p-6 lg:col-span-2">
              <ChartHeader title="予約推移（過去30日）" subtitle="施設別の内訳と合計推移" />
              <div className="w-full h-[240px]">
                {reservationChartData && reservationChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={reservationChartData}
                      margin={{ top: 5, right: 5, left: -25, bottom: 0 }}
                    >
                      <defs>
                        {stats!.facilityIds.map((fid, i) => (
                          <linearGradient key={fid} id={`grad_${fid}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={FACILITY_COLORS[i % FACILITY_COLORS.length]} stopOpacity={0.9} />
                            <stop offset="100%" stopColor={FACILITY_COLORS[i % FACILITY_COLORS.length]} stopOpacity={0.6} />
                          </linearGradient>
                        ))}
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false}
                        tickFormatter={(v) => dayjs(v).format("M/D")} interval="preserveStartEnd" minTickGap={40} />
                      <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip
                        content={
                          <ChartTooltip
                            labelFormatter={(l) => dayjs(l).format("M月D日（dd）")}
                            valueFormatter={(v) => `${v}件`}
                          />
                        }
                        cursor={{ fill: "rgba(0,0,0,0.04)" }}
                      />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px", paddingTop: "8px", color: "#374151" }}
                        formatter={(value: string) => stats!.facilityNames[value] || value} />
                      {stats!.facilityIds.map((fid, i) => (
                        <Bar key={fid} dataKey={fid} name={stats!.facilityNames[fid] || fid} stackId="a"
                          fill={`url(#grad_${fid})`} barSize={18}
                          radius={i === stats!.facilityIds.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
                      ))}
                      <Line dataKey="total" name="合計" type="monotone" stroke="#1a1a2e" strokeWidth={2.5}
                        dot={false} activeDot={{ r: 4, fill: "#1a1a2e", stroke: "#fff", strokeWidth: 2 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-gray-400">データがありません</div>
                )}
              </div>
            </StatCard>

            {/* 2. ユーザー登録推移 */}
            <StatCard className="p-5 sm:p-6">
              <ChartHeader title="ユーザー登録推移" subtitle="過去30日の累計と新規" />
              <div className="w-full aspect-[1.8/1] min-h-[180px]">
                {stats?.userGrowth && stats.userGrowth.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={stats.userGrowth} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gradUser" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#2563eb" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="#2563eb" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false}
                        tickFormatter={(v) => dayjs(v).format("M/D")} interval="preserveStartEnd" minTickGap={40} />
                      <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip
                        content={
                          <ChartTooltip
                            labelFormatter={(l) => dayjs(l).format("M月D日")}
                            valueFormatter={(v, name) => name === "新規" ? `+${v}名` : `${v}名`}
                          />
                        }
                      />
                      <Area dataKey="total" name="累計" type="monotone" stroke="#2563eb" strokeWidth={2}
                        fill="url(#gradUser)" dot={false} activeDot={{ r: 3, fill: "#2563eb", stroke: "#fff", strokeWidth: 2 }} />
                      <Bar dataKey="newUsers" name="新規" fill="#2563eb" opacity={0.7} barSize={6} radius={[2, 2, 0, 0]} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-gray-400">データがありません</div>
                )}
              </div>
            </StatCard>

            {/* 3. 時間帯別予約分布 */}
            <StatCard className="p-5 sm:p-6">
              <ChartHeader title="時間帯別の予約分布" subtitle="全期間の予約開始時刻" />
              <div className="w-full aspect-[1.8/1] min-h-[180px]">
                {stats?.hourlyDistribution && stats.hourlyDistribution.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats.hourlyDistribution} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gradHourly" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#0d9488" stopOpacity={0.9} />
                          <stop offset="100%" stopColor="#0d9488" stopOpacity={0.5} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                      <XAxis dataKey="hour" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip
                        content={
                          <ChartTooltip
                            labelFormatter={(l) => `${l}〜`}
                            valueFormatter={(v) => `${v}件`}
                          />
                        }
                        cursor={{ fill: "rgba(0,0,0,0.04)" }}
                      />
                      <Bar dataKey="count" name="予約数" fill="url(#gradHourly)" radius={[4, 4, 0, 0]} barSize={22} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-gray-400">データがありません</div>
                )}
              </div>
            </StatCard>

            {/* 4. 施設別利用率（ドーナツ） */}
            <StatCard className="p-5 sm:p-6">
              <ChartHeader title="施設別の利用割合" subtitle="全期間の予約比率" />
              <div className="w-full aspect-[1.8/1] min-h-[180px]">
                {stats?.facilityUsage && stats.facilityUsage.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={stats.facilityUsage}
                        cx="50%"
                        cy="50%"
                        innerRadius="45%"
                        outerRadius="75%"
                        dataKey="count"
                        nameKey="name"
                        paddingAngle={3}
                        stroke="none"
                      >
                        {stats.facilityUsage.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        content={
                          <ChartTooltip valueFormatter={(v) => `${v}件`} />
                        }
                      />
                      <Legend
                        iconType="circle"
                        iconSize={8}
                        wrapperStyle={{ fontSize: "11px", color: "#374151" }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-gray-400">データがありません</div>
                )}
              </div>
            </StatCard>

            {/* 5. グッド数ランキング */}
            <StatCard className="p-5 sm:p-6">
              <ChartHeader title="グッド数ランキング" subtitle="イベントの人気度" />
              <div className="space-y-2.5 mt-2">
                {stats?.eventRanking && stats.eventRanking.length > 0 ? (
                  stats.eventRanking
                    .sort((a, b) => b.goodCount - a.goodCount)
                    .slice(0, 6)
                    .map((item, i) => {
                      const maxGood = Math.max(...stats.eventRanking.map((x) => x.goodCount));
                      const pct = maxGood > 0 ? (item.goodCount / maxGood) * 100 : 0;
                      return (
                        <div key={item.id} className="flex items-center gap-3">
                          <span className="text-xs font-bold text-gray-400 w-4 text-right shrink-0">
                            {i + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-teal-100 text-teal-700">
                                イベント
                              </span>
                              <span className="text-xs text-[#1a1a2e] font-medium truncate">{item.title}</span>
                            </div>
                            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{
                                  width: `${pct}%`,
                                  background: "linear-gradient(90deg, #0d9488, #14b8a6)",
                                }}
                              />
                            </div>
                          </div>
                          <span className="text-xs font-bold text-[#1a1a2e] shrink-0">
                            {item.goodCount}
                          </span>
                        </div>
                      );
                    })
                ) : (
                  <div className="flex items-center justify-center py-8 text-sm text-gray-400">
                    データがありません
                  </div>
                )}
              </div>
            </StatCard>
          </div>

          {/* コンテンツKPI + クイックアクション */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <MiniKPI label="ゲーム" value="—" unit="準備中" accent="text-blue-600" />
            <MiniKPI label="イベント" value={`${stats?.publishedEvents ?? 0}/${stats?.totalEvents ?? 0}`} unit="公開中" accent="text-teal-600" />
            <Link
              href="/admin/users"
              className="flex items-center gap-2.5 px-4 py-4 text-xs font-medium rounded-xl bg-white border border-gray-200 shadow-sm text-gray-600 hover:bg-gray-50 hover:shadow-md transition-all duration-200"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M2 13c0-2.761 2.686-5 6-5s6 2.239 6 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              ユーザー管理
            </Link>
            <Link
              href="/admin/reservations"
              className="flex items-center gap-2.5 px-4 py-4 text-xs font-medium rounded-xl bg-white border border-gray-200 shadow-sm text-gray-600 hover:bg-gray-50 hover:shadow-md transition-all duration-200"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="1" y="2" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M5 1v2M11 1v2M1 7h14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              予約一覧
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
