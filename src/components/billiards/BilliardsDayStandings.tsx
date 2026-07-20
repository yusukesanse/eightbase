"use client";

import { Avatar } from "@/components/ui/LineContact";
import { BILLIARDS_ACCENT } from "@/components/billiards/billiardsShared";

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
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[13px] font-extrabold text-[#1c1f21]">この日の成績</div>
        <div className="text-[10.5px] text-[#3f4247] tabular-nums">{eventDate}</div>
      </div>
      <p className="text-[10.5px] text-[#3f4247] mt-0.5 mb-2.5">※ この開催日の成績のみ（通算はリーグタブ）</p>
      <div className="flex flex-col gap-1.5">
        {standings.map((s) => (
          <div key={s.dayRank + s.displayName} className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl" style={s.isMe ? { background: `color-mix(in srgb, ${BILLIARDS_ACCENT} 8%, #fff)`, boxShadow: `inset 0 0 0 1.5px ${BILLIARDS_ACCENT}` } : undefined}>
            <span className="w-[22px] text-center font-black tabular-nums shrink-0" style={{ fontSize: s.dayRank <= 3 ? 16 : 14, color: s.dayRank <= 3 ? BILLIARDS_ACCENT : "#3f4247", letterSpacing: "-.03em" }}>{s.dayRank}</span>
            <Avatar src={s.pictureUrl} name={s.displayName} size={30} />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold text-[#1c1f21] truncate">
                {s.displayName}
                {s.isMe && <span className="ml-1.5 text-[10px] font-extrabold" style={{ color: BILLIARDS_ACCENT }}>YOU</span>}
              </div>
              <div className="text-[10.5px] text-[#97999d] tabular-nums">{s.wins}勝{s.losses}敗</div>
            </div>
            <div className="text-right shrink-0 min-w-[46px]">
              <div className="text-[15px] font-black text-[#1c1f21] tabular-nums leading-none">{s.totalPt}</div>
              <div className="text-[9px] font-bold text-[#3f4247] mt-0.5">pt</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
