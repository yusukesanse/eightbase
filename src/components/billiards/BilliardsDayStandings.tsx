"use client";

import { Avatar } from "@/components/ui/LineContact";
import { GlassCard, StatusPill } from "@/components/ui/eb";

/** ビリヤード 当日成績（その開催日の総合順位＋勝敗）。参加タブで過去の開催日を選ぶと表示。 */
export interface BilliardsDayStanding {
  dayRank: number;
  displayName: string;
  pictureUrl?: string;
  totalPt: number;
  wins: number;
  losses: number;
  isMe: boolean;
  matches: { result: "win" | "lose"; points: number; opponentName: string }[];
}

export function BilliardsDayStandings({ eventDate, standings }: { eventDate: string; standings: BilliardsDayStanding[] }) {
  return (
    <GlassCard padding="md">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[15px] font-bold text-[color:var(--eb-ink)] whitespace-nowrap">この日の成績</div>
        <div className="text-[12px] text-[color:var(--eb-ink-muted)] tabular-nums whitespace-nowrap shrink-0">{eventDate}</div>
      </div>
      <p className="text-[12px] text-[color:var(--eb-ink-muted)] mt-0.5 mb-2.5">
        ※ この開催日の成績のみ（通算はリーグタブ）
      </p>
      <div className="flex flex-col gap-1.5">
        {standings.map((s) => (
          <div
            key={s.dayRank + s.displayName}
            className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl"
            style={
              s.isMe
                ? { background: "rgba(35,147,94,.08)", boxShadow: "inset 0 0 0 1.5px var(--eb-green)" }
                : undefined
            }
          >
            <span
              className="w-6 text-center font-bold tabular-nums shrink-0"
              style={{ fontSize: s.dayRank <= 3 ? 17 : 15, color: "rgba(26,29,27,.6)" }}
            >
              {s.dayRank}
            </span>
            <Avatar src={s.pictureUrl} name={s.displayName} size={32} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 text-[15px] font-bold text-[color:var(--eb-ink)] truncate">
                {s.displayName}
                {s.isMe && <StatusPill tone="green">YOU</StatusPill>}
              </div>
              <div className="text-[11px] text-[color:var(--eb-ink-muted)] tabular-nums mt-0.5 whitespace-nowrap">
                {s.wins}勝{s.losses}敗
              </div>
            </div>
            <div className="text-right shrink-0 min-w-[46px]">
              <div className="text-[15px] font-bold text-[color:var(--eb-ink)] tabular-nums leading-none">{s.totalPt}</div>
              <div className="text-[10px] font-bold text-[color:var(--eb-ink-muted)] mt-0.5">pt</div>
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
