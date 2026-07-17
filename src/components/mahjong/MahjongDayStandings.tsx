"use client";

import { Avatar } from "@/components/ui/LineContact";

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

const ACCENT = "#2f7d57";

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
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[13px] font-extrabold text-[#1c1f21]">この日の順位</div>
        <div className="text-[10.5px] text-[#6b6e73] tabular-nums">{eventDate}</div>
      </div>
      <p className="text-[10.5px] text-[#6b6e73] mt-0.5 mb-2.5">
        ※ この開催日の成績のみ（通算はリーグタブ）
      </p>
      <div className="flex flex-col gap-1.5">
        {standings.map((s) => (
          <div
            key={s.rank}
            className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl"
            style={
              s.isMe
                ? { background: `color-mix(in srgb, ${ACCENT} 8%, #fff)`, boxShadow: `inset 0 0 0 1.5px ${ACCENT}` }
                : undefined
            }
          >
            <span
              className="w-[22px] text-center font-black tabular-nums shrink-0"
              style={{ fontSize: s.rank <= 3 ? 16 : 14, color: s.rank <= 3 ? ACCENT : "#6b6e73", letterSpacing: "-.03em" }}
            >
              {s.rank}
            </span>
            <Avatar src={s.pictureUrl} name={s.displayName} size={30} />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold text-[#1c1f21] truncate">
                {s.displayName}
                {s.isMe && <span className="ml-1.5 text-[10px] font-extrabold" style={{ color: ACCENT }}>YOU</span>}
              </div>
              <div className="flex gap-2 mt-0.5 text-[10.5px] text-[#6b6e73] tabular-nums">
                <span>{s.gamesPlayed}半荘</span>
                <span>1位 {s.firstCount}</span>
                <span>連対 {pct(s.top2Rate)}</span>
              </div>
            </div>
            <div className="text-right shrink-0 min-w-[58px]">
              <div className="text-[15px] font-black text-[#1c1f21] tabular-nums leading-none">
                {byTotal ? s.totalPoints.toLocaleString() : Math.round(s.average).toLocaleString()}
              </div>
              <div className="text-[9px] font-bold text-[#6b6e73] mt-0.5">{byTotal ? "合計点" : "AVG"}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
