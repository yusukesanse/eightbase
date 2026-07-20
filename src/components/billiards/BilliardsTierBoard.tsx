"use client";

/* Hallmark · component: league-board (data-driven) · genre: playful-sport · theme: EIGHTBASE billiards tokens
 * layout: tier rows of player balls (B1/B2/B3) on felt — legible "who is in each tier"
 * palette: felt #2f7d57 / B1 #a2125a / B2 #1172a5 / B3 #b48f13 (CLAUDE.md tokens)
 */

import { Avatar } from "@/components/ui/LineContact";
import { BILLIARDS_TIER } from "@/components/billiards/billiardsShared";

/**
 * ビリヤードリーグ LEAGUE BOARD（ティア横並び）。
 * 各ティア(B1/B2/B3)を「選手＝ビリヤード球（アバター）」の横一列で見せる。左にティアバッジ＋人数、
 * 自分の球には「あなた」ピル＋強調リング。球タップで戦歴シート（onSelect）。
 * フェルト緑の台紙＝ビリヤードらしさ。順位の高い人から左詰め。
 */

type Tier = "B1" | "B2" | "B3";

export interface BoardStanding {
  rank: number;
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  tier: Tier;
  isMe: boolean;
}

const TIERS: Tier[] = ["B1", "B2", "B3"];

export function BilliardsTierBoard({
  standings,
  onSelect,
}: {
  standings: BoardStanding[];
  onSelect: (lineUserId: string) => void;
}) {
  return (
    <div
      className="rounded-[22px] overflow-hidden"
      style={{
        background: "radial-gradient(130% 110% at 28% 0%, #33885e, #124228)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,.08), inset 0 0 46px rgba(0,0,0,.34)",
      }}
    >
      {/* ヘッダー */}
      <div className="px-4 pt-3.5 pb-2 text-center">
        <div className="text-[11px] font-extrabold tracking-[0.22em]" style={{ color: "#ffe6a6" }}>LEAGUE BOARD</div>
        <div className="text-[10.5px] text-white/55 mt-0.5">エイトボール 1対1 リーグ</div>
      </div>

      <div className="px-3 pb-3">
        {TIERS.map((tier, i) => {
          const rows = standings.filter((s) => s.tier === tier).sort((a, b) => a.rank - b.rank);
          const color = BILLIARDS_TIER[tier].color;
          return (
            <div
              key={tier}
              className="flex items-center gap-3 py-2.5"
              style={i > 0 ? { borderTop: "1px solid rgba(255,255,255,.09)" } : undefined}
            >
              {/* ティアバッジ＋人数 */}
              <div className="w-[42px] shrink-0 flex flex-col items-start gap-1">
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-black text-white" style={{ background: color, boxShadow: "0 1px 2px rgba(0,0,0,.25)" }}>{tier}</span>
                <span className="text-[10px] font-bold text-white/70 pl-0.5">{rows.length}名</span>
              </div>

              {/* 選手ボールの横一列 */}
              {rows.length === 0 ? (
                <div className="text-[11px] text-white/45 py-2">まだいません</div>
              ) : (
                <div className="flex gap-2.5 overflow-x-auto py-0.5 pr-1">
                  {rows.map((s) => (
                    <PlayerBall key={s.lineUserId} s={s} color={color} onSelect={onSelect} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PlayerBall({ s, color, onSelect }: { s: BoardStanding; color: string; onSelect: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(s.lineUserId)}
      className="flex flex-col items-center gap-1 shrink-0 active:scale-[0.96] transition-transform"
      style={{ width: 46 }}
      aria-label={`${s.displayName} の戦歴`}
    >
      {/* 「あなた」ピル用の固定スロット（球を揃える） */}
      <div className="h-[15px] flex items-end">
        {s.isMe && (
          <span className="inline-flex items-center rounded-full px-1.5 leading-none text-[9px] font-black text-white" style={{ height: 15, background: "#231714" }}>あなた</span>
        )}
      </div>

      {/* 球（アバター＋ティアリング＋ビリヤード艶） */}
      <div
        className="relative rounded-full"
        style={{ width: 44, height: 44, boxShadow: s.isMe ? `0 0 0 2px #fff, 0 0 0 4px ${color}, 0 2px 5px rgba(0,0,0,.35)` : `0 0 0 2px ${color}, 0 2px 4px rgba(0,0,0,.3)` }}
      >
        <Avatar src={s.pictureUrl} name={s.displayName} size={44} />
        <span
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle at 32% 26%, rgba(255,255,255,.55), rgba(255,255,255,0) 46%)" }}
        />
      </div>

      {/* 略称（アバターが無い/被り対策の補助・1行） */}
      <span className="max-w-[46px] truncate text-[9.5px] font-bold text-white/85 leading-none">{s.displayName}</span>
    </button>
  );
}
