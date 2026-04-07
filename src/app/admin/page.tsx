"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dayjs from "dayjs";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";

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
}

/* ── 施設ごとのカラーパレット ── */
const FACILITY_COLORS = [
  "#6366f1", // indigo
  "#06b6d4", // cyan
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#14b8a6", // teal
];

/* ── ミニKPIカード ── */
function MiniKPI({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: number | string;
  unit?: string;
  accent?: string;
}) {
  return (
    <div className="flex-1 min-w-[120px] px-4 py-3 rounded-xl bg-white/40 backdrop-blur-sm border border-white/60 shadow-sm shadow-black/5">
      <p className="text-[11px] text-slate-400 font-medium mb-1">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className={`text-xl font-bold ${accent || "text-slate-800"}`}>
          {value}
        </span>
        {unit && <span className="text-xs text-slate-400">{unit}</span>}
      </div>
    </div>
  );
}

/* ── カスタムツールチップ ── */
function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    color: string;
    dataKey: string;
  }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-xl bg-white/80 backdrop-blur-xl border border-white/70 shadow-lg shadow-black/10 px-4 py-3 min-w-[140px]">
      <p className="text-xs font-semibold text-slate-700 mb-2">
        {label ? dayjs(label).format("M月D日（dd）") : ""}
      </p>
      {payload
        .filter((p) => p.dataKey !== "total")
        .map((p, i) => (
          <div key={i} className="flex items-center justify-between gap-4 py-0.5">
            <div className="flex items-center gap-1.5">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: p.color }}
              />
              <span className="text-xs text-slate-500">{p.name}</span>
            </div>
            <span className="text-xs font-semibold text-slate-800">
              {p.value}件
            </span>
          </div>
        ))}
      {payload.find((p) => p.dataKey === "total") && (
        <div className="flex items-center justify-between gap-4 pt-1.5 mt-1.5 border-t border-slate-200/60">
          <span className="text-xs font-medium text-slate-500">合計</span>
          <span className="text-xs font-bold text-slate-900">
            {payload.find((p) => p.dataKey === "total")?.value}件
          </span>
        </div>
      )}
    </div>
  );
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  }, []);

  // チャートデータ整形
  const chartData = stats?.dailyData?.map((d) => {
    const entry: Record<string, string | number> = {
      date: d.date,
      total: d.total,
    };
    stats.facilityIds.forEach((fid) => {
      entry[fid] = d.facilities[fid] || 0;
    });
    return entry;
  });

  const today = dayjs().format("YYYY年M月D日");

  return (
    <div className="p-6 md:p-8 max-w-5xl">
      {/* ヘッダー */}
      <div className="mb-6">
        <h2 className="text-xl font-bold text-slate-800">ダッシュボード</h2>
        <p className="text-xs text-slate-400 mt-1">{today}</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="rounded-xl bg-red-50/60 backdrop-blur-sm border border-red-200/40 p-5 text-sm text-red-600">
          {error}
        </div>
      ) : (
        <>
          {/* ミニKPI */}
          <div className="flex flex-wrap gap-3 mb-6">
            <MiniKPI label="登録ユーザー" value={stats?.totalUsers ?? 0} unit="名" />
            <MiniKPI
              label="今日の予約"
              value={stats?.todayReservations ?? 0}
              unit="件"
              accent="text-indigo-600"
            />
            <MiniKPI
              label="今後の予約"
              value={stats?.upcomingReservations ?? 0}
              unit="件"
              accent="text-emerald-600"
            />
            <MiniKPI
              label="今月の予約"
              value={stats?.reservationsThisMonth ?? 0}
              unit="件"
              accent="text-amber-600"
            />
            <MiniKPI label="累計予約" value={stats?.totalReservations ?? 0} unit="件" />
          </div>

          {/* 複合チャート */}
          <div className="rounded-2xl bg-white/50 backdrop-blur-xl border border-white/60 shadow-lg shadow-black/5 p-5 md:p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">
                  予約推移（過去30日）
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  施設別の内訳と合計推移
                </p>
              </div>
            </div>

            <div className="h-[280px] md:h-[320px]">
              {chartData && chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={chartData}
                    margin={{ top: 5, right: 5, left: -20, bottom: 0 }}
                  >
                    <defs>
                      {stats!.facilityIds.map((fid, i) => (
                        <linearGradient
                          key={fid}
                          id={`grad_${fid}`}
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor={FACILITY_COLORS[i % FACILITY_COLORS.length]}
                            stopOpacity={0.8}
                          />
                          <stop
                            offset="100%"
                            stopColor={FACILITY_COLORS[i % FACILITY_COLORS.length]}
                            stopOpacity={0.4}
                          />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#e2e8f0"
                      strokeOpacity={0.5}
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: "#94a3b8" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => dayjs(v).format("M/D")}
                      interval="preserveStartEnd"
                      minTickGap={30}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "#94a3b8" }}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      content={<ChartTooltip />}
                      cursor={{ fill: "rgba(99,102,241,0.06)" }}
                    />
                    <Legend
                      iconType="circle"
                      iconSize={8}
                      wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
                      formatter={(value: string) =>
                        stats!.facilityNames[value] || value
                      }
                    />
                    {stats!.facilityIds.map((fid, i) => (
                      <Bar
                        key={fid}
                        dataKey={fid}
                        name={stats!.facilityNames[fid] || fid}
                        stackId="a"
                        fill={`url(#grad_${fid})`}
                        radius={
                          i === stats!.facilityIds.length - 1
                            ? [3, 3, 0, 0]
                            : [0, 0, 0, 0]
                        }
                        barSize={14}
                      />
                    ))}
                    <Line
                      dataKey="total"
                      name="合計"
                      type="monotone"
                      stroke="#334155"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{
                        r: 4,
                        fill: "#334155",
                        stroke: "#fff",
                        strokeWidth: 2,
                      }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-slate-400">
                  データがありません
                </div>
              )}
            </div>
          </div>

          {/* クイックアクション */}
          <div className="flex flex-wrap gap-3">
            <Link
              href="/admin/users"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-[13px] font-medium rounded-xl bg-white/50 backdrop-blur-sm border border-white/60 shadow-sm shadow-black/5 text-slate-700 hover:bg-white/70 hover:shadow-md transition-all duration-200"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M2 13c0-2.761 2.686-5 6-5s6 2.239 6 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              ユーザーを追加
            </Link>
            <Link
              href="/admin/reservations"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-[13px] font-medium rounded-xl bg-white/50 backdrop-blur-sm border border-white/60 shadow-sm shadow-black/5 text-slate-700 hover:bg-white/70 hover:shadow-md transition-all duration-200"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="1" y="2" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M5 1v2M11 1v2M1 7h14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              予約一覧を見る
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
