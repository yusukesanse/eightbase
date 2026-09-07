"use client";

import { Avatar } from "@/components/ui/LineContact";
import { GlassCard, StatusPill } from "@/components/ui/eb";

/**
 * 当日順位リスト（その開催日だけの順位）。通算順位（リーグタブ）とは別物。
 * データは GET /api/mahjong/standings/day の公開DTO（lineUserId は持たず isMe のみ）。
 * M1/M2/M3 の tier 分けはしない（その日のフラットな 1位〜N位）。
 */

export interface DayStanding {
  rank: number;
  displayName: string;
  pictureUrl?: string;
  gamesPlayed: number;
  totalPoints: number;
  average: number;
  firstCount: number;
  top2Rate: number;
  isMe?: boolean;
}

/** 連対率の表示（0–1 でも 0–100 でも %・小数第2位）。 */
function pct(v: number): string {
  if (v == null || Number.isNaN(v)) return "0.00%";
  const n = v <= 1 ? v * 100 : v;
  return `${n.toFixed(2)}%`;
}

export function MahjongDayStandings({
  eventDate,
  standings,
  rankingMetric,
}: {
  eventDate: string;
  standings: DayStanding[];
  rankingMetric: "average" | "total";
}) {
  const byTotal = rankingMetric === "total";
  return (
    <GlassCard padding="md">
      <div className="flex items-baseline justify-between">
        <div className="text-[15px] font-bold text-[color:var(--eb-ink)]">この日の順位</div>
        <div className="text-[12px] text-[color:var(--eb-ink-muted)] tabular-nums">{eventDate}</div>
      </div>
      <p className="text-[12px] text-[color:var(--eb-ink-muted)] mt-0.5 mb-2.5">
        ※ この開催日の成績のみ（通算はリーグタブ）
      </p>
      <div className="flex flex-col gap-1.5">
        {standings.map((s) => {
          const value = byTotal ? s.totalPoints : Math.round(s.average);
          const valueColor =
            value > 0 ? "var(--eb-green-text)" : value < 0 ? "var(--eb-coral-text)" : "var(--eb-ink)";
          return (
            <div
              key={s.rank}
              className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl"
              style={
                s.isMe
                  ? { background: "rgba(35,147,94,.08)", boxShadow: "inset 0 0 0 1.5px var(--eb-green)" }
                  : undefined
              }
            >
              <span
                className="w-6 text-center text-[17px] font-bold tabular-nums shrink-0"
                style={{ color: "rgba(26,29,27,.6)" }}
              >
                {s.rank}
              </span>
              <Avatar src={s.pictureUrl} name={s.displayName} size={32} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 text-[15px] font-bold text-[color:var(--eb-ink)] truncate">
                  {s.displayName}
                  {s.isMe && <StatusPill tone="green">YOU</StatusPill>}
                </div>
                <div className="flex gap-2 mt-0.5 text-[11px] text-[color:var(--eb-ink-muted)] tabular-nums">
                  <span>{s.gamesPlayed}半荘</span>
                  <span>1位 {s.firstCount}</span>
                  <span>連対 {pct(s.top2Rate)}</span>
                </div>
              </div>
              <div className="text-right shrink-0 min-w-[58px]">
                <div className="text-[15px] font-bold tabular-nums leading-none" style={{ color: valueColor }}>
                  {value.toLocaleString()}
                </div>
                <div className="text-[10px] font-bold text-[color:var(--eb-ink-muted)] mt-0.5">{byTotal ? "合計点" : "AVG"}</div>
              </div>
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}
