"use client";

import { Avatar } from "@/components/ui/LineContact";
import { POKER_ACCENT, fmtChips } from "@/components/poker/pokerShared";

/**
 * ポーカー 当日成績（その開催日だけの総合順位＋各試合のチップ内訳）。通算（リーグタブ）とは別物。
 * データは GET /api/poker/standings/day の公開DTO（isMe のみ）。参加タブで過去の開催日を選ぶと表示。
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
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[13px] font-extrabold text-[#1c1f21]">この日の成績</div>
        <div className="text-[10.5px] text-[#3f4247] tabular-nums">{eventDate}</div>
      </div>
      <p className="text-[10.5px] text-[#3f4247] mt-0.5 mb-2.5">
        ※ この開催日の成績のみ（通算はリーグタブ）。順位は当日の通算チップ数。
      </p>
      <div className="flex flex-col gap-1.5">
        {standings.map((s) => (
          <div
            key={s.dayRank + s.displayName}
            className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl"
            style={s.isMe ? { background: `color-mix(in srgb, ${POKER_ACCENT} 8%, #fff)`, boxShadow: `inset 0 0 0 1.5px ${POKER_ACCENT}` } : undefined}
          >
            <span
              className="w-[22px] text-center font-black tabular-nums shrink-0"
              style={{ fontSize: s.dayRank <= 3 ? 16 : 14, color: s.dayRank <= 3 ? POKER_ACCENT : "#3f4247", letterSpacing: "-.03em" }}
            >
              {s.dayRank}
            </span>
            <Avatar src={s.pictureUrl} name={s.displayName} size={30} />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold text-[#1c1f21] truncate">
                {s.displayName}
                {s.isMe && <span className="ml-1.5 text-[10px] font-extrabold" style={{ color: POKER_ACCENT }}>YOU</span>}
              </div>
              {/* 各試合のチップ内訳 */}
              <div className="flex gap-1.5 mt-1 flex-wrap">
                {s.games.map((g) => (
                  <span
                    key={g.gameIndex}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
                    style={{ background: "#f6f8f9", color: g.rank === 1 ? POKER_ACCENT : "#40434a", boxShadow: "inset 0 0 0 1px #eceff1" }}
                  >
                    <span className="text-[#97999d]">#{g.gameIndex}</span>
                    {g.rank}位
                    <span className="text-[#97999d]">{fmtChips(g.chips)}</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="text-right shrink-0 min-w-[56px]">
              <div className="text-[15px] font-black text-[#1c1f21] tabular-nums leading-none">{fmtChips(s.totalChips)}</div>
              <div className="text-[9px] font-bold text-[#3f4247] mt-0.5">チップ</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
