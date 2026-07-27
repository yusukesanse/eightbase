"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/LineContact";
import { GamePlayerHistorySheet } from "@/components/GamePlayerHistorySheet";
import { POKER_ACCENT, POKER_TIER_COLOR, fmtChips } from "@/components/poker/pokerShared";
import { PokerRoyalBoard } from "@/components/poker/PokerRoyalBoard";
import { type PokerTier } from "@/types/poker";

/**
 * ポーカー リーグボード（Figma 4c Royal Board 111:49 準拠。ダーツ LeagueBoard と同デザイン言語）。
 * ROYAL BOARD ヒーロー＋P1/P2/P3 のセクション別ランキング＋脚注。
 * データは GET /api/poker/standings（通算チップ合計順。tier P1(1-4)/P2(5-8)/P3(9+)）。
 */

interface Standing {
  rank: number;
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  totalChips: number;
  days: number;
  firsts: number;
  tier: PokerTier;
  isMe: boolean;
  trend: number[];
}

const TIER = {
  P1: { color: POKER_TIER_COLOR.P1, label: "P1.LEAGUE", range: "通算 1〜4位" },
  P2: { color: POKER_TIER_COLOR.P2, label: "P2.LEAGUE", range: "通算 5〜8位" },
  P3: { color: POKER_TIER_COLOR.P3, label: "P3.LEAGUE", range: "通算 9位以下" },
} as const;

// 自分の行の強調（金＝あなた。ROYAL BOARD の金縁リングと同系色）。
const YOU_ROW = { background: "#fbf6e8", border: "1.5px solid #e6bd52" } as const;

export function PokerLeagueBoard() {
  const [standings, setStandings] = useState<Standing[]>([]);
  const [counts, setCounts] = useState<Record<PokerTier, number>>({ P1: 0, P2: 0, P3: 0 });
  const [seasonName, setSeasonName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyId, setHistoryId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/poker/standings", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setStandings(d.standings ?? []);
        setCounts(d.counts ?? { P1: 0, P2: 0, P3: 0 });
        setSeasonName(d.seasonName ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (standings.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-10 text-center text-sm text-[#231714]/80">
        まだ成績がありません。開催日に参加してチップを集めましょう。
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[14px]">
      {/* ヒーロー: ROYAL BOARD（上位12名のトランプカードグリッド） */}
      <PokerRoyalBoard standings={standings} counts={counts} seasonName={seasonName} />

      {(["P1", "P2", "P3"] as PokerTier[]).map((tier) => {
        const rows = standings.filter((s) => s.tier === tier);
        if (rows.length === 0) return null;
        return (
          <div key={tier} className="flex flex-col gap-2">
            <div className="flex items-center gap-2 px-0.5">
              <span className="text-[13px] font-black" style={{ color: TIER[tier].color }}>{TIER[tier].label}</span>
              <span className="text-[11px] text-[#97999d]">{TIER[tier].range}</span>
              <div className="flex-1 h-px bg-[#eceff1]" />
            </div>
            {rows.map((s) => (
              <RankRow key={s.lineUserId} s={s} tierColor={TIER[tier].color} onSelect={setHistoryId} />
            ))}
          </div>
        );
      })}

      {/* 脚注 */}
      <p className="px-0.5 text-[11px] text-[#97999d] leading-[1.6]">
        順位は各開催の獲得チップを通算。同チップの場合は1位回数 → 出場数 → 名前順。
      </p>

      {historyId && (
        <GamePlayerHistorySheet
          lineUserId={historyId}
          gameCategory="poker"
          accent={POKER_ACCENT}
          onClose={() => setHistoryId(null)}
        />
      )}
    </div>
  );
}

function RankRow({ s, tierColor, onSelect }: { s: Standing; tierColor: string; onSelect: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(s.lineUserId)}
      className="w-full text-left flex items-center gap-2.5 rounded-[14px] px-3 py-2.5 active:scale-[0.99] transition-transform"
      style={s.isMe ? YOU_ROW : { border: "1px solid #eceff1", background: "#fff" }}
    >
      <span className="w-[22px] text-center text-[16px] font-black tabular-nums" style={{ color: tierColor }}>{s.rank}</span>
      <Avatar src={s.pictureUrl} name={s.displayName} size={34} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[13.5px] font-bold text-[#1c1f21] truncate">{s.displayName}</span>
          {s.isMe && <span className="shrink-0 text-[10.5px] font-bold" style={{ color: tierColor }}>YOU</span>}
        </div>
        <div className="text-[10.5px] text-[#97999d]">出場 {s.days}回 ・ 1位 {s.firsts}回</div>
      </div>
      <Sparkline data={s.trend} color={tierColor} />
      <div className="flex items-end gap-[2px] shrink-0">
        <span className="text-[16px] font-black text-[#1c1f21] tabular-nums leading-none">{fmtChips(s.totalChips)}</span>
        <span className="text-[9.5px] font-bold text-[#97999d] leading-none">Chips</span>
      </div>
    </button>
  );
}

/** 累積チップの推移スパークライン（開催日順）。1点以下はプレースホルダ。 */
function Sparkline({ data, color, w = 52, h = 22 }: { data: number[]; color: string; w?: number; h?: number }) {
  if (!data || data.length < 2) {
    return (
      <svg width={w} height={h} className="shrink-0" aria-hidden>
        <line x1={2} y1={h - 4} x2={w - 2} y2={h - 4} stroke="#e4e7e9" strokeWidth={1.5} strokeLinecap="round" />
      </svg>
    );
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pad = 3;
  const pts = data.map((v, i) => {
    const x = pad + (i * (w - pad * 2)) / (data.length - 1);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = pts[pts.length - 1].split(",");
  return (
    <svg width={w} height={h} className="shrink-0" aria-hidden>
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
      <circle cx={last[0]} cy={last[1]} r={2} fill={color} />
    </svg>
  );
}
