"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/LineContact";
import { POKER_ACCENT, fmtChips } from "@/components/poker/pokerShared";
import { type PokerTier } from "@/types/poker";

/**
 * ポーカー リーグボード（通算チップ合計順）。tier P1(1-4)/P2(5-8)/P3(9+)。
 * データは GET /api/poker/standings。トレンドは各開催日の累積チップ推移。
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
interface Me { rank: number; tier: PokerTier; totalChips: number; days: number; firsts: number; gapToP1: number }

const TIER_COLOR: Record<PokerTier, string> = { P1: "#a2125a", P2: "#1172a5", P3: "#b48f13" };
const TIER_LABEL: Record<PokerTier, string> = { P1: "P1（1〜4位）", P2: "P2（5〜8位）", P3: "P3（9位〜）" };

function Sparkline({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return null;
  const w = 56, h = 18, max = Math.max(...points, 1), min = Math.min(...points, 0);
  const span = max - min || 1;
  const d = points
    .map((p, i) => `${(i / (points.length - 1)) * w},${h - ((p - min) / span) * h}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="shrink-0">
      <polyline points={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function PokerLeagueBoard() {
  const [standings, setStandings] = useState<Standing[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [seasonName, setSeasonName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/poker/standings", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setStandings(d.standings ?? []);
        setMe(d.me ?? null);
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

  const tiers: PokerTier[] = ["P1", "P2", "P3"];

  return (
    <div className="flex flex-col gap-4">
      {/* ヒーロー（黒・全ゲーム統一トーン） */}
      <div className="rounded-2xl p-5 text-white" style={{ background: "#17191b" }}>
        <div className="text-[11px] font-bold opacity-70">ポーカーリーグ{seasonName ? ` ・ ${seasonName}` : ""}</div>
        <div className="text-[13px] font-bold mt-0.5 opacity-90">通算チップ合計で順位が決まります</div>
        {me && (
          <div className="mt-3 flex items-end gap-4">
            <div>
              <div className="text-[10px] opacity-70">あなたの順位</div>
              <div className="text-[28px] font-black leading-none" style={{ color: TIER_COLOR[me.tier] }}>
                {me.rank}
                <span className="text-[13px] font-bold ml-1 opacity-80">位 / {me.tier}</span>
              </div>
            </div>
            <div className="flex-1 text-right">
              <div className="text-[10px] opacity-70">通算チップ</div>
              <div className="text-[20px] font-black tabular-nums leading-none">{fmtChips(me.totalChips)}</div>
              {me.gapToP1 > 0 && <div className="text-[10px] opacity-70 mt-1">P1まで {fmtChips(me.gapToP1)}</div>}
            </div>
          </div>
        )}
      </div>

      {tiers.map((tier) => {
        const rows = standings.filter((s) => s.tier === tier);
        if (rows.length === 0) return null;
        return (
          <div key={tier} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-2 text-[12px] font-black text-white" style={{ background: TIER_COLOR[tier] }}>
              {TIER_LABEL[tier]}
            </div>
            <div className="divide-y divide-gray-50">
              {rows.map((s) => (
                <div
                  key={s.lineUserId}
                  className="flex items-center gap-2.5 px-3 py-2.5"
                  style={s.isMe ? { background: `color-mix(in srgb, ${POKER_ACCENT} 7%, #fff)` } : undefined}
                >
                  <span className="w-[24px] text-center font-black tabular-nums shrink-0" style={{ color: TIER_COLOR[tier], letterSpacing: "-.03em" }}>
                    {s.rank}
                  </span>
                  <Avatar src={s.pictureUrl} name={s.displayName} size={32} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold text-[#1c1f21] truncate">
                      {s.displayName}
                      {s.isMe && <span className="ml-1.5 text-[10px] font-extrabold" style={{ color: POKER_ACCENT }}>YOU</span>}
                    </div>
                    <div className="text-[10px] text-[#3f4247] tabular-nums mt-0.5">
                      {s.days}開催 ・ 1位 {s.firsts}回
                    </div>
                  </div>
                  <Sparkline points={s.trend} color={TIER_COLOR[tier]} />
                  <div className="text-right shrink-0 min-w-[58px]">
                    <div className="text-[15px] font-black text-[#1c1f21] tabular-nums leading-none">{fmtChips(s.totalChips)}</div>
                    <div className="text-[9px] font-bold text-[#3f4247] mt-0.5">チップ</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
