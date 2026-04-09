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
  questRanking: { id: string; title: string; goodCount: number; type: string }[];
  eventRanking: { id: string; title: string; goodCount: number; type: string }[];
  facilityUsage: { name: string; count: number }[];
  totalQuests: number;
  publishedQuests: number;
  totalEvents: number;
  publishedEvents: number;
}

/* ── カラーパレット ── */

const FACILITY_COLORS = [
  "#A5C1C8", "#8BA8AF", "#B0E401", "#C5D94A", "#ef4444", "#7BA8B0", "#A5C1C8", "#8BA8AF",
];
const PIE_COLORS = [
  "#A5C1C8", "#8BA8AF", "#B0E401", "#C5D94A", "#ef4444", "#7BA8B0",
];

/* ── 共通コンポーネント ── */

function GlassCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl bg-white/50 backdrop-blur-xl border border-white/60 shadow-sm shadow-[#A5C1C8]/8 ${className}`}
    >
      {children}
    </div>
  );
}

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
    <div className="px-4 py-3 rounded-xl bg-white/40 backdrop-blur-sm border border-white/60 shadow-sm shadow-black/[0.03] min-w-0">
      <p className="text-[11px] text-[#414141]/40 font-medium mb-1 truncate">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className={`text-lg sm:text-xl font-bold ${accent || "text-[#414141]"}`}>
          {value}
        </span>
        {unit && <span className="text-[11px] text-[#414141]/40">{unit}</span>}
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
      <h3 className="text-sm font-semibold text-[#414141]">{title}</h3>
      {subtitle && (
        <p className="text-[11px] text-[#414141]/40 mt-0.5">{subtitle}</p>
      )}
    </div>
  );
}

/* ── カスタムツールチップ ── */

function GlassTooltip({
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
    <div className="rounded-xl bg-white/85 backdrop-blur-xl border border-white/70 shadow-lg shadow-black/10 px-4 py-3 min-w-[130px]">
      <p className="text-[11px] font-semibold text-[#414141]/60 mb-1.5">
        {labelFormatter ? labelFormatter(label || "") : label}
      </p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <div
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: p.color }}
            />
            <span className="text-[11px] text-[#414141]/60 truncate">{p.name}</span>
          </div>
          <span className="text-[11px] font-semibold text-[#414141] shrink-0">
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
    <div className="p-4 sm:p-6 md:p-8">
      {/* ヘッダー */}
      <div className="mb-5">
        <h2 className="text-lg sm:text-xl font-bold text-[#414141]">ダッシュボード</h2>
        <p className="text-[11px] text-[#414141]/40 mt-0.5">{today}</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-[#A5C1C8]/40 border-t-[#A5C1C8] rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="rounded-xl bg-red-50/60 backdrop-blur-sm border border-red-200/40 p-5 text-sm text-red-600">
          {error}
        </div>
      ) : (
        <>
          {/* ミニKPI */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
            <MiniKPI label="登録ユーザー" value={stats?.totalUsers ?? 0} unit="名" />
            <MiniKPI label="今日の予約" value={stats?.todayReservations ?? 0} unit="件" accent="text-[#A5C1C8]" />
            <MiniKPI label="今後の予約" value={stats?.upcomingReservations ?? 0} unit="件" accent="text-[#B0E401]" />
            <MiniKPI label="今月の予約" value={stats?.reservationsThisMonth ?? 0} unit="件" accent="text-[#C5D94A]" />
            <MiniKPI label="累計予約" value={stats?.totalReservations ?? 0} unit="件" />
          </div>

          {/* ── グラフ 2列グリッド ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">

            {/* 1. 予約推移（全幅） */}
            <GlassCard className="p-4 sm:p-5 lg:col-span-2">
              <ChartHeader title="予約推移（過去30日）" subtitle="施設別の内訳と合計推移" />
              <div className="w-full aspect-[2.2/1] min-h-[200px]">
                {reservationChartData && reservationChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={reservationChartData}
                      margin={{ top: 5, right: 5, left: -25, bottom: 0 }}
                    >
                      <defs>
                        {stats!.facilityIds.map((fid, i) => (
                          <linearGradient key={fid} id={`grad_${fid}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={FACILITY_COLORS[i % FACILITY_COLORS.length]} stopOpacity={0.8} />
                            <stop offset="100%" stopColor={FACILITY_COLORS[i % FACILITY_COLORS.length]} stopOpacity={0.35} />
                          </linearGradient>
                        ))}
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.5} vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#A5C1C8" }} tickLine={false} axisLine={false}
                        tickFormatter={(v) => dayjs(v).format("M/D")} interval="preserveStartEnd" minTickGap={40} />
                      <YAxis tick={{ fontSize: 10, fill: "#A5C1C8" }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip
                        content={
                          <GlassTooltip
                            labelFormatter={(l) => dayjs(l).format("M月D日（dd）")}
                            valueFormatter={(v) => `${v}件`}
                          />
                        }
                        cursor={{ fill: "rgba(165,193,200,0.06)" }}
                      />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
                        formatter={(value: string) => stats!.facilityNames[value] || value} />
                      {stats!.facilityIds.map((fid, i) => (
                        <Bar key={fid} dataKey={fid} name={stats!.facilityNames[fid] || fid} stackId="a"
                          fill={`url(#grad_${fid})`} barSize={16}
                          radius={i === stats!.facilityIds.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
                      ))}
                      <Line dataKey="total" name="合計" type="monotone" stroke="#414141" strokeWidth={2}
                        dot={false} activeDot={{ r: 4, fill: "#414141", stroke: "#fff", strokeWidth: 2 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-slate-400">データがありません</div>
                )}
              </div>
            </GlassCard>

            {/* 2. ユーザー登録推移 */}
            <GlassCard className="p-4 sm:p-5">
              <ChartHeader title="ユーザー登録推移" subtitle="過去30日の累計と新規" />
              <div className="w-full aspect-[1.8/1] min-h-[180px]">
                {stats?.userGrowth && stats.userGrowth.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={stats.userGrowth} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gradUser" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#A5C1C8" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="#A5C1C8" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.5} vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#A5C1C8" }} tickLine={false} axisLine={false}
                        tickFormatter={(v) => dayjs(v).format("M/D")} interval="preserveStartEnd" minTickGap={40} />
                      <YAxis tick={{ fontSize: 10, fill: "#A5C1C8" }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip
                        content={
                          <GlassTooltip
                            labelFormatter={(l) => dayjs(l).format("M月D日")}
                            valueFormatter={(v, name) => name === "新規" ? `+${v}名` : `${v}名`}
                          />
                        }
                      />
                      <Area dataKey="total" name="累計" type="monotone" stroke="#A5C1C8" strokeWidth={2}
                        fill="url(#gradUser)" dot={false} activeDot={{ r: 3, fill: "#A5C1C8", stroke: "#fff", strokeWidth: 2 }} />
                      <Bar dataKey="newUsers" name="新規" fill="#A5C1C8" opacity={0.6} barSize={6} radius={[2, 2, 0, 0]} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-slate-400">データがありません</div>
                )}
              </div>
            </GlassCard>

            {/* 3. 時間帯別予約分布 */}
            <GlassCard className="p-4 sm:p-5">
              <ChartHeader title="時間帯別の予約分布" subtitle="全期間の予約開始時刻" />
              <div className="w-full aspect-[1.8/1] min-h-[180px]">
                {stats?.hourlyDistribution && stats.hourlyDistribution.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats.hourlyDistribution} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gradHourly" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#8BA8AF" stopOpacity={0.8} />
                          <stop offset="100%" stopColor="#8BA8AF" stopOpacity={0.3} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.5} vertical={false} />
                      <XAxis dataKey="hour" tick={{ fontSize: 10, fill: "#A5C1C8" }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: "#A5C1C8" }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip
                        content={
                          <GlassTooltip
                            labelFormatter={(l) => `${l}〜`}
                            valueFormatter={(v) => `${v}件`}
                          />
                        }
                        cursor={{ fill: "rgba(139,168,175,0.06)" }}
                      />
                      <Bar dataKey="count" name="予約数" fill="url(#gradHourly)" radius={[4, 4, 0, 0]} barSize={20} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-slate-400">データがありません</div>
                )}
              </div>
            </GlassCard>

            {/* 4. 施設別利用率（ドーナツ） */}
            <GlassCard className="p-4 sm:p-5">
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
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} opacity={0.85} />
                        ))}
                      </Pie>
                      <Tooltip
                        content={
                          <GlassTooltip valueFormatter={(v) => `${v}件`} />
                        }
                      />
                      <Legend
                        iconType="circle"
                        iconSize={8}
                        wrapperStyle={{ fontSize: "11px" }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-slate-400">データがありません</div>
                )}
              </div>
            </GlassCard>

            {/* 5. グッド数ランキング */}
            <GlassCard className="p-4 sm:p-5">
              <ChartHeader title="グッド数ランキング" subtitle="クエスト・イベントの人気度" />
              <div className="space-y-2 mt-2">
                {stats?.questRanking && stats.questRanking.length > 0 ? (
                  [...stats.questRanking, ...stats.eventRanking]
                    .sort((a, b) => b.goodCount - a.goodCount)
                    .slice(0, 6)
                    .map((item, i) => {
                      const maxGood = Math.max(
                        ...[...stats.questRanking, ...stats.eventRanking].map((x) => x.goodCount)
                      );
                      const pct = maxGood > 0 ? (item.goodCount / maxGood) * 100 : 0;
                      return (
                        <div key={item.id} className="flex items-center gap-3">
                          <span className="text-[11px] font-bold text-[#414141]/40 w-4 text-right shrink-0">
                            {i + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                                item.type === "quest"
                                  ? "bg-[#A5C1C8]/20 text-[#414141]"
                                  : "bg-[#B0E401]/20 text-[#414141]"
                              }`}>
                                {item.type === "quest" ? "クエスト" : "イベント"}
                              </span>
                              <span className="text-[12px] text-[#414141] truncate">{item.title}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-[#414141]/10 overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{
                                  width: `${pct}%`,
                                  background: item.type === "quest"
                                    ? "linear-gradient(90deg, #A5C1C8, #7BA8B0)"
                                    : "linear-gradient(90deg, #B0E401, #C5D94A)",
                                }}
                              />
                            </div>
                          </div>
                          <span className="text-[12px] font-bold text-[#414141]/60 shrink-0">
                            {item.goodCount}
                          </span>
                        </div>
                      );
                    })
                ) : (
                  <div className="flex items-center justify-center py-8 text-sm text-[#414141]/40">
                    データがありません
                  </div>
                )}
              </div>
            </GlassCard>
          </div>

          {/* コンテンツKPI + クイックアクション */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <MiniKPI label="クエスト" value={`${stats?.publishedQuests ?? 0}/${stats?.totalQuests ?? 0}`} unit="公開中" accent="text-[#A5C1C8]" />
            <MiniKPI label="イベント" value={`${stats?.publishedEvents ?? 0}/${stats?.totalEvents ?? 0}`} unit="公開中" accent="text-[#B0E401]" />
            <Link
              href="/admin/users"
              className="flex items-center gap-2 px-4 py-3 text-[12px] font-medium rounded-xl bg-white/40 backdrop-blur-sm border border-white/60 shadow-sm shadow-black/[0.03] text-[#414141]/60 hover:bg-white/60 hover:shadow-md transition-all duration-200"
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M2 13c0-2.761 2.686-5 6-5s6 2.239 6 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              ユーザー管理
            </Link>
            <Link
              href="/admin/reservations"
              className="flex items-center gap-2 px-4 py-3 text-[12px] font-medium rounded-xl bg-white/40 backdrop-blur-sm border border-white/60 shadow-sm shadow-black/[0.03] text-[#414141]/60 hover:bg-white/60 hover:shadow-md transition-all duration-200"
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
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
