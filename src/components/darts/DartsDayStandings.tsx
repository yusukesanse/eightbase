"use client";

import { Avatar } from "@/components/ui/LineContact";
import { DARTS_ACCENT } from "@/components/darts/dartsShared";
import type { DartsEventKind } from "@/types/darts";

/**
 * ダーツ 当日成績（その開催日だけの総合順位＋3種目内訳）。通算（リーグタブ）とは別物。
 * データは GET /api/darts/standings/day の公開DTO（isMe のみ）。参加タブで過去の開催日を選ぶと表示。
 */

interface DayEvent { kind: DartsEventKind; value: number | null; rank: number | null; points: number; teamId?: string }
export interface DartsDayStanding {
  dayRank: number;
  displayName: string;
  pictureUrl?: string;
  totalPt: number;
  firstCount: number;
  isMe: boolean;
  events: DayEvent[];
}

const SHORT: Record<DartsEventKind, string> = { zeroOne: "01", countUp: "CU", cricket: "CR" };
const ORDER: DartsEventKind[] = ["zeroOne", "countUp", "cricket"];

export function DartsDayStandings({ eventDate, standings }: { eventDate: string; standings: DartsDayStanding[] }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[13px] font-extrabold text-[#1c1f21]">この日の成績</div>
        <div className="text-[10.5px] text-[#3f4247] tabular-nums">{eventDate}</div>
      </div>
      <p className="text-[10.5px] text-[#3f4247] mt-0.5 mb-2.5">
        ※ この開催日の成績のみ（通算はリーグタブ）。01=ゼロワン / CU=カウントアップ / CR=クリケット
      </p>
      <div className="flex flex-col gap-1.5">
        {standings.map((s) => (
          <div
            key={s.dayRank + s.displayName}
            className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl"
            style={s.isMe ? { background: `color-mix(in srgb, ${DARTS_ACCENT} 8%, #fff)`, boxShadow: `inset 0 0 0 1.5px ${DARTS_ACCENT}` } : undefined}
          >
            <span
              className="w-[22px] text-center font-black tabular-nums shrink-0"
              style={{ fontSize: s.dayRank <= 3 ? 16 : 14, color: s.dayRank <= 3 ? DARTS_ACCENT : "#3f4247", letterSpacing: "-.03em" }}
            >
              {s.dayRank}
            </span>
            <Avatar src={s.pictureUrl} name={s.displayName} size={30} />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold text-[#1c1f21] truncate">
                {s.displayName}
                {s.isMe && <span className="ml-1.5 text-[10px] font-extrabold" style={{ color: DARTS_ACCENT }}>YOU</span>}
              </div>
              {/* 3種目内訳（種目短縮 + 着順） */}
              <div className="flex gap-1.5 mt-1 flex-wrap">
                {ORDER.map((kind) => {
                  const e = s.events.find((x) => x.kind === kind);
                  const rank = e?.rank ?? null;
                  return (
                    <span
                      key={kind}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
                      style={{ background: "#f6f8f9", color: rank === 1 ? DARTS_ACCENT : "#40434a", boxShadow: "inset 0 0 0 1px #eceff1" }}
                    >
                      <span className="text-[#97999d]">{SHORT[kind]}</span>
                      {rank != null ? `${rank}位` : "—"}
                      <span className="text-[#97999d]">{e ? `${e.points}pt` : ""}</span>
                    </span>
                  );
                })}
              </div>
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
