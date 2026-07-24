"use client";

import { Avatar } from "@/components/ui/LineContact";
import { POKER_TIER_COLOR, fmtChips } from "@/components/poker/pokerShared";
import type { PokerTier } from "@/types/poker";

/**
 * ポーカーリーグのヒーロー「CHIP RACE」（Figma: hero-chip-race 101:63）。
 * 通算チップ上位10名を、チップ（22×7のピル）の積み上げで可視化するレースチャート。
 * - チップ色 = tier（P1=1〜4位 マゼンタ / P2=5〜8位 ブルー / P3=9位〜 ゴールド。麻雀M1/M2/M3と同一DS色）
 * - 枚数はチップ合計に比例（最大12枚・最少1枚）。数値と順位はトップ3のみマゼンタ強調
 * - 自分は金縁リング（金縁＝あなた）。凡例に P1/P2 ライン（4位・8位のチップ数）を表示
 */

export interface ChipRaceStanding {
  rank: number;
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  totalChips: number;
  days: number;
  tier: PokerTier;
  isMe: boolean;
}

const MAX_CHIP_COUNT = 12;
const YOU_RING = "#E6BD52";

function ChipStack({ count, color }: { count: number; color: string }) {
  return (
    <div className="flex flex-col-reverse items-center gap-[2px]">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="rounded-full"
          style={{
            width: 22,
            height: 7,
            backgroundColor: color,
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.45)",
          }}
        />
      ))}
    </div>
  );
}

export function PokerChipRace({
  standings,
  seasonName,
  me,
}: {
  standings: ChipRaceStanding[];
  seasonName?: string | null;
  me?: { rank: number; tier: PokerTier; totalChips: number; gapToP1: number } | null;
}) {
  const top = standings.slice(0, 10);
  if (top.length === 0) return null;

  const maxChips = Math.max(...top.map((s) => s.totalChips), 1);
  const heldDays = Math.max(...top.map((s) => s.days), 0);
  const p1Line = standings[3]?.totalChips;
  const p2Line = standings[7]?.totalChips;
  const meOutside = me && me.rank > 10;

  return (
    <div
      className="bg-white rounded-[22px] px-3.5 pt-4 pb-3.5 flex flex-col gap-3 overflow-hidden"
      style={{ boxShadow: "0 6px 16px rgba(28,31,33,0.05), 0 1px 3px rgba(28,31,33,0.05)" }}
    >
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold text-[#7fa0a6]" style={{ letterSpacing: "1.98px" }}>
          CHIP RACE
        </span>
        <span className="text-[10px] text-[#97999d]">
          {seasonName ? `${seasonName} ・ ` : ""}第{heldDays}開催終了時点
        </span>
      </div>

      {/* レースチャート（上位10名・下端揃え） */}
      <div className="flex items-end justify-center gap-[6px] h-[200px] max-w-[325px] w-full mx-auto">
        {top.map((s) => {
          const color = POKER_TIER_COLOR[s.tier];
          const isTop3 = s.rank <= 3;
          const chipCount = Math.max(1, Math.round((s.totalChips / maxChips) * MAX_CHIP_COUNT));
          return (
            <div key={s.lineUserId} className="flex-1 min-w-0 flex flex-col items-center justify-end gap-1">
              <span
                className="text-[9.5px] font-bold tabular-nums leading-none"
                style={{ color: isTop3 ? "#a2125a" : "#97999d" }}
              >
                {fmtChips(s.totalChips)}
              </span>
              <ChipStack count={chipCount} color={color} />
              <div
                className="rounded-full mt-[3px]"
                style={
                  s.isMe
                    ? { boxShadow: `0 0 0 1.5px ${color}, 0 0 0 3px #fff, 0 0 0 4.5px ${YOU_RING}` }
                    : { boxShadow: `0 0 0 1.5px ${color}` }
                }
              >
                <Avatar src={s.pictureUrl} name={s.displayName} size={24} />
              </div>
              <span
                className="text-[10px] font-bold tabular-nums leading-none mt-[2px]"
                style={{ color: isTop3 ? "#a2125a" : "#97999d" }}
              >
                {s.rank}
              </span>
            </div>
          );
        })}
      </div>

      {/* 凡例 */}
      <div className="text-[10px] text-[#97999d] leading-relaxed">
        {p1Line !== undefined && <>P1ライン: {fmtChips(p1Line)} </>}
        {p2Line !== undefined && <>／ P2ライン: {fmtChips(p2Line)} </>}
        ・ 金縁＝あなた
        {me && (
          <span className="block">
            あなた: {me.rank}位 / {me.tier} ・ 通算 {fmtChips(me.totalChips)}
            {me.gapToP1 > 0 && <> ・ P1まで {fmtChips(me.gapToP1)}</>}
            {meOutside && <>（圏外のため上のチャートには表示されていません）</>}
          </span>
        )}
      </div>
    </div>
  );
}
