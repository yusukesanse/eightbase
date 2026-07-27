"use client";

import { Avatar } from "@/components/ui/LineContact";
import { POKER_TIER_COLOR, fmtChips } from "@/components/poker/pokerShared";
import type { PokerTier } from "@/types/poker";

/**
 * ポーカーリーグのヒーロー「ROYAL BOARD」（Figma: 4c Royal Board 111:49）。
 * 通算チップ上位12名をトランプカードのグリッド（4列×3段）で可視化する。
 * - カードのランクは順位に対応（1位=A, 2位=K, 3位=Q, …）。スートは tier
 *   （P1=♠ / P2=♦ / P3=♣）、色はリーグDS色（麻雀M1/M2/M3と同一）
 * - 自分のカードは tier 色の枠＋アバター金縁リング（金縁＝あなた）
 * - 凡例は P1/P2/P3 の人数と自分の所属（Figmaの D1/D2/D3 表記は既存 tier 名に統一）
 */

export interface RoyalBoardStanding {
  rank: number;
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  totalChips: number;
  tier: PokerTier;
  isMe: boolean;
  days: number;
}

const BOARD_SIZE = 12;
const YOU_RING = "#E6BD52";
const CARD_RANKS = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"];
const TIER_SUIT: Record<PokerTier, string> = { P1: "♠", P2: "♦", P3: "♣" };

/** 表示名の姓（最初の空白まで）。カード幅が狭いため姓のみ表示する。 */
const surname = (name: string): string => name.split(/[\s　]+/)[0] || name;

function PlayerCard({ s }: { s: RoyalBoardStanding }) {
  const color = POKER_TIER_COLOR[s.tier];
  return (
    <div
      className="relative w-full aspect-[59/86] rounded-[7px] bg-white flex flex-col items-center justify-end pb-[5px]"
      style={
        s.isMe
          ? { boxShadow: `0 0 0 2px ${color}, 0 0 10px ${color}66` }
          : { boxShadow: "0 1px 3px rgba(0,0,0,0.35)" }
      }
    >
      {/* コーナー（ランク＋スート） */}
      <div className="absolute top-[3px] left-[6px] flex flex-col items-center leading-none">
        <span className="text-[11px] font-bold" style={{ color }}>
          {CARD_RANKS[Math.min(s.rank - 1, CARD_RANKS.length - 1)]}
        </span>
        <span className="text-[8px]" style={{ color }}>{TIER_SUIT[s.tier]}</span>
      </div>
      <div
        className="rounded-full mb-[5px]"
        style={
          s.isMe
            ? { boxShadow: `0 0 0 1.5px ${color}, 0 0 0 3px #fff, 0 0 0 4.5px ${YOU_RING}` }
            : { boxShadow: `0 0 0 1.5px ${color}` }
        }
      >
        <Avatar src={s.pictureUrl} name={s.displayName} size={24} />
      </div>
      <span className="max-w-full px-1 text-[9px] font-bold text-[#1c1f21] leading-none truncate">
        {surname(s.displayName)}
      </span>
      <span className="text-[10px] font-bold tabular-nums leading-none mt-[3px]" style={{ color }}>
        {fmtChips(s.totalChips)}
      </span>
    </div>
  );
}

function LegendItem({ tier, count, you }: { tier: PokerTier; count: number; you: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-block rotate-45 rounded-[3px]" style={{ width: 11, height: 11, background: POKER_TIER_COLOR[tier] }} />
      <span className="text-[11px] font-bold text-white/95">{tier}</span>
      <span className="text-[11px] text-white/60">
        {count}名{you && <span className="font-black" style={{ color: "#e8ce86" }}> ・ あなた</span>}
      </span>
    </div>
  );
}

export function PokerRoyalBoard({
  standings,
  counts,
  seasonName,
}: {
  standings: RoyalBoardStanding[];
  counts: Record<PokerTier, number>;
  seasonName?: string | null;
}) {
  const board = standings.slice(0, BOARD_SIZE);
  if (board.length === 0) return null;

  const heldDays = Math.max(...standings.map((s) => s.days), 0);
  const meTier = standings.find((s) => s.isMe)?.tier ?? null;

  return (
    <div
      className="rounded-[22px] px-3.5 pt-4 pb-[14px] flex flex-col gap-3 overflow-hidden"
      style={{ background: "#16181a", boxShadow: "0 6px 16px rgba(28,31,33,0.05), 0 1px 3px rgba(28,31,33,0.05)" }}
    >
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold" style={{ color: "#7fa0a6", letterSpacing: "1.98px" }}>
          ROYAL BOARD
        </span>
        <span className="text-[10px] text-[#97999d]">
          {seasonName ? `${seasonName} ・ ` : ""}第{heldDays}開催終了時点
        </span>
      </div>

      {/* カードグリッド（上位12名） */}
      <div className="grid grid-cols-4 gap-x-[10px] gap-y-[12px] w-full max-w-[280px] mx-auto">
        {board.map((s) => (
          <PlayerCard key={s.lineUserId} s={s} />
        ))}
      </div>

      {/* 凡例 */}
      <div className="flex items-center justify-between max-w-[280px] w-full mx-auto pt-1 flex-wrap gap-y-1">
        {(["P1", "P2", "P3"] as PokerTier[]).map((tier) => (
          <LegendItem key={tier} tier={tier} count={counts[tier] ?? 0} you={meTier === tier} />
        ))}
      </div>
    </div>
  );
}
