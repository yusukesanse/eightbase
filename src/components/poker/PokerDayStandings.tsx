"use client";

import { Avatar } from "@/components/ui/LineContact";
import { GlassCard, StatusPill } from "@/components/ui/eb";
import { fmtChips } from "@/components/poker/pokerShared";

/**
 * ポーカー 当日成績(その開催日だけの総合順位＋各試合のチップ内訳)。通算(リーグタブ)とは別物。
 * データは GET /api/poker/standings/day の公開DTO(isMe のみ)。参加タブで過去の開催日を選ぶと表示。
 */

interface DayGame { gameIndex: number; chips: number; rank: number }
export interface PokerDayStanding {
  dayRank: number;
  displayName: string;
  pictureUrl?: string;
  totalChips: number;
  gamesPlayed: number;
  isMe: boolean;
  games: DayGame[];
}

export function PokerDayStandings({ eventDate, standings }: { eventDate: string; standings: PokerDayStanding[] }) {
  return (
    <GlassCard padding="md">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[15px] font-bold text-[color:var(--eb-ink)] whitespace-nowrap">この日の成績</div>
        <div className="text-[12px] text-[color:var(--eb-ink-muted)] tabular-nums whitespace-nowrap shrink-0">{eventDate}</div>
      </div>
      <p className="text-[12px] text-[color:var(--eb-ink-muted)] mt-0.5 mb-2.5">
        ※ この開催日の成績のみ（通算はリーグタブ）。順位は当日の通算チップ数。
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
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[15px] font-bold text-[color:var(--eb-ink)] truncate min-w-0">{s.displayName}</span>
                {s.isMe && <span className="shrink-0"><StatusPill tone="green">YOU</StatusPill></span>}
              </div>
              {/* 各試合のチップ内訳 */}
              <div className="flex gap-1.5 mt-1 flex-wrap">
                {s.games.map((g) => (
                  <span
                    key={g.gameIndex}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums whitespace-nowrap shrink-0"
                    style={{
                      background: "var(--eb-tint)",
                      color: g.rank === 1 ? "var(--eb-green-text)" : "var(--eb-ink-muted)",
                    }}
                  >
                    <span className="text-[color:var(--eb-ink-muted)]">#{g.gameIndex}</span>
                    {g.rank}位
                    <span className="text-[color:var(--eb-ink-muted)]">{fmtChips(g.chips)}</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="text-right shrink-0 min-w-[56px]">
              <div className="text-[15px] font-bold text-[color:var(--eb-ink)] tabular-nums leading-none">{fmtChips(s.totalChips)}</div>
              <div className="text-[10px] font-bold text-[color:var(--eb-ink-muted)] mt-0.5">チップ</div>
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
