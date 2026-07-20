"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/LineContact";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { GamePlayerHistorySheet } from "@/components/GamePlayerHistorySheet";
import { BilliardsTierBoard } from "@/components/billiards/BilliardsTierBoard";
import { BILLIARDS_ACCENT, BILLIARDS_TIER } from "@/components/billiards/billiardsShared";

/**
 * ビリヤードリーグ LEAGUE BOARD。フェルト緑のティア横並び（B1/B2/B3を選手ボールで表示）を
 * ヒーローに、ビューアーバンド、階層ランキング（通算pt＋スパークライン）、フォーマット、脚注。
 * データは /api/billiards/standings。ボール/順位行タップで戦歴シート。
 */

type Tier = "B1" | "B2" | "B3";

interface Standing {
  rank: number;
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  totalPt: number;
  games: number;
  firsts: number;
  tier: Tier;
  isMe: boolean;
  trend: number[];
}
interface Me { rank: number; tier: Tier; totalPt: number; games: number; firsts: number; gapToB1: number }
interface Resp { standings: Standing[]; me: Me | null; counts: { B1: number; B2: number; B3: number } }

export function BilliardsLeagueBoard() {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyId, setHistoryId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/billiards/standings", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { if (alive && !d.error) setData(d); })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);
  useAutoRefresh(() => fetch("/api/billiards/standings", { credentials: "include" }).then((r) => r.json()).then((d) => !d.error && setData(d)).catch(() => {}), 15000);

  if (loading) return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" /></div>;

  const standings = data?.standings ?? [];
  const me = data?.me ?? null;
  const meStanding = standings.find((s) => s.isMe) ?? null;

  return (
    <div className="flex flex-col gap-[14px]">
      {/* Hero: フェルト緑のティア横並び（選手ボール） */}
      <BilliardsTierBoard standings={standings} onSelect={setHistoryId} />

      {/* Viewer band */}
      {me && meStanding && (
        <div className="flex items-center gap-3 rounded-[16px] border border-[#eceff1] bg-white px-[14px] py-3">
          <div className="relative shrink-0">
            <Avatar src={meStanding.pictureUrl} name={meStanding.displayName} size={44} />
            <span className="absolute -bottom-0.5 -right-0.5 grid place-items-center rounded-[9px] border-2 border-white text-[10px] font-black text-white" style={{ width: 18, height: 18, background: BILLIARDS_TIER[me.tier].color }}>{me.rank}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-bold text-[#1c1f21] truncate">{meStanding.displayName}</span>
              <span className="shrink-0 rounded-[6px] px-1.5 py-0.5 text-[10.5px] font-bold" style={{ color: BILLIARDS_TIER[me.tier].color, background: `color-mix(in srgb, ${BILLIARDS_TIER[me.tier].color} 12%, #fff)` }}>{me.tier} {me.rank}位</span>
            </div>
            <div className="text-[12px] text-[#97999d] mt-0.5">
              {me.gapToB1 > 0 ? <><span className="text-[#40434a]">B1昇格まで</span> <span className="font-bold text-[#5f7a80]">+{me.gapToB1}pt</span></> : <span className="text-[#40434a]">B1リーグ在籍中</span>}
            </div>
          </div>
          <div className="flex flex-col items-end shrink-0">
            <span className="text-[18px] font-black text-[#1c1f21] tabular-nums">{me.totalPt}</span>
            <span className="text-[10px] text-[#97999d]">通算pt ・ 出場 {me.games}回</span>
          </div>
        </div>
      )}

      {/* Rankings */}
      {standings.length === 0 ? (
        <div className="rounded-[14px] border border-[#eceff1] bg-white p-8 text-center text-sm text-[#231714]/70">まだ順位データがありません</div>
      ) : (
        <div className="flex flex-col gap-[18px]">
          {(["B1", "B2", "B3"] as Tier[]).map((tier) => {
            const rows = standings.filter((s) => s.tier === tier);
            if (rows.length === 0) return null;
            return (
              <div key={tier} className="flex flex-col gap-2">
                <div className="flex items-center gap-2 px-0.5">
                  <span className="text-[13px] font-black" style={{ color: BILLIARDS_TIER[tier].color }}>{BILLIARDS_TIER[tier].label}</span>
                  <span className="text-[11px] text-[#97999d]">{BILLIARDS_TIER[tier].range}</span>
                  <div className="flex-1 h-px bg-[#eceff1]" />
                </div>
                {rows.map((s) => <RankRow key={s.rank} s={s} tierColor={BILLIARDS_TIER[tier].color} onSelect={setHistoryId} />)}
              </div>
            );
          })}
        </div>
      )}

      {/* Format */}
      <div className="rounded-[14px] border border-[#eceff1] bg-white px-[14px] pt-3 pb-[14px] flex flex-col gap-1.5">
        <div className="text-[10px] font-bold tracking-[0.14em] text-[#97999d]">開催フォーマット</div>
        <div className="text-[12.5px] font-bold text-[#40434a] leading-[1.5]">エイトボール 1対1 ・ 第2/第4土曜 13:00〜18:00</div>
        <div className="text-[11px] text-[#97999d] leading-[1.5]">勝者14pt / 敗者=落とした玉数。通算合計点で順位</div>
      </div>

      <p className="px-0.5 text-[11px] text-[#97999d] leading-[1.6]">順位は各試合の獲得ptを通算。同ptの場合は勝利数 → 対戦数 → 名前順。</p>

      {historyId && <GamePlayerHistorySheet lineUserId={historyId} gameCategory="billiards" accent={BILLIARDS_ACCENT} onClose={() => setHistoryId(null)} />}
    </div>
  );
}

function RankRow({ s, tierColor, onSelect }: { s: Standing; tierColor: string; onSelect: (id: string) => void }) {
  const topThree = s.rank <= 3;
  return (
    <button type="button" onClick={() => onSelect(s.lineUserId)} className="w-full text-left flex items-center gap-2.5 rounded-[14px] px-3 py-2.5 active:scale-[0.99] transition-transform" style={s.isMe ? { border: `1.5px solid ${tierColor}`, background: `color-mix(in srgb, ${tierColor} 8%, #fff)` } : { border: "1px solid #eceff1", background: "#fff" }}>
      <span className="w-[22px] text-center text-[16px] font-black tabular-nums" style={{ color: topThree ? tierColor : "#97999d" }}>{s.rank}</span>
      <Avatar src={s.pictureUrl} name={s.displayName} size={34} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[13.5px] font-bold text-[#1c1f21] truncate">{s.displayName}</span>
          {s.isMe && <span className="shrink-0 text-[10px] font-bold tracking-[0.05em]" style={{ color: tierColor }}>YOU</span>}
        </div>
        <div className="text-[10.5px] text-[#97999d]">出場 {s.games}回 ・ 1位 {s.firsts}回</div>
      </div>
      <Sparkline data={s.trend} color={tierColor} />
      <div className="flex flex-col items-end shrink-0">
        <span className="text-[16px] font-black text-[#1c1f21] tabular-nums">{s.totalPt}</span>
        <span className="text-[9.5px] font-bold text-[#97999d]">pt</span>
      </div>
    </button>
  );
}

function Sparkline({ data, color, w = 52, h = 22 }: { data: number[]; color: string; w?: number; h?: number }) {
  if (!data || data.length < 2) {
    return <svg width={w} height={h} className="shrink-0" aria-hidden><line x1={2} y1={h - 4} x2={w - 2} y2={h - 4} stroke="#e4e7e9" strokeWidth={1.5} strokeLinecap="round" /></svg>;
  }
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1, pad = 3;
  const pts = data.map((v, i) => `${(pad + (i * (w - pad * 2)) / (data.length - 1)).toFixed(1)},${(h - pad - ((v - min) / span) * (h - pad * 2)).toFixed(1)}`);
  const last = pts[pts.length - 1].split(",");
  return (
    <svg width={w} height={h} className="shrink-0" aria-hidden>
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
      <circle cx={last[0]} cy={last[1]} r={2} fill={color} />
    </svg>
  );
}
