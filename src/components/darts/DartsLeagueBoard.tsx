"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/LineContact";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";

/**
 * ダーツリーグ「LEAGUE BOARD」（Figma 案1b・node 62:49 準拠）。
 * 黒いヒーロー＋ダーツボード（D1/D2/D3の同心リング）＋凡例、ビューアーバンド、
 * D1/D2/D3の階層ランキング、開催フォーマット、脚注。
 * データは /api/darts/standings（通算pt・出場・1位回数・tier・自分判定）。
 * ※ スパークライン（推移グラフ）は履歴データが無いため省略（麻雀順位リストと同方針）。
 */

type Tier = "D1" | "D2" | "D3";
const TIER = {
  D1: { color: "#a2125a", label: "D1.LEAGUE", range: "通算 1〜4位" },
  D2: { color: "#1172a5", label: "D2.LEAGUE", range: "通算 5〜8位" },
  D3: { color: "#b48f13", label: "D3.LEAGUE", range: "通算 9位以下" },
} as const;
const GOLD = "#e6bd52";

interface Standing {
  rank: number;
  displayName: string;
  pictureUrl?: string;
  totalPt: number;
  games: number;
  firsts: number;
  tier: Tier;
  isMe: boolean;
  trend: number[]; // 開催日順の累積pt推移（スパークライン）
}
interface Me { rank: number; tier: Tier; totalPt: number; games: number; firsts: number; gapToD1: number }
interface StandingsResp {
  standings: Standing[];
  me: Me | null;
  counts: { D1: number; D2: number; D3: number };
}

export function DartsLeagueBoard() {
  const [data, setData] = useState<StandingsResp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/darts/standings", { credentials: "include" })
        .then((r) => r.json())
        .then((d) => { if (alive && !d.error) setData(d); })
        .catch(() => {})
        .finally(() => alive && setLoading(false));
    load();
    return () => { alive = false; };
  }, []);
  useAutoRefresh(
    () => fetch("/api/darts/standings", { credentials: "include" }).then((r) => r.json()).then((d) => !d.error && setData(d)).catch(() => {}),
    15000
  );

  if (loading) {
    return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" /></div>;
  }

  const standings = data?.standings ?? [];
  const me = data?.me ?? null;
  const counts = data?.counts ?? { D1: 0, D2: 0, D3: 0 };
  const meStanding = standings.find((s) => s.isMe) ?? null;

  return (
    <div className="flex flex-col gap-[14px]">
      {/* Hero / LEAGUE BOARD */}
      <div
        className="flex flex-col items-center gap-[10px] rounded-[22px] px-4 pt-[18px] pb-4 overflow-hidden"
        style={{ background: "#17191b", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)" }}
      >
        <div className="text-[10.5px] font-bold tracking-[0.22em]" style={{ color: GOLD }}>LEAGUE BOARD</div>
        <DartBoard meTier={meStanding?.tier ?? null} meName={meStanding?.displayName} />
        <div className="flex gap-[18px] items-center pt-1 flex-wrap justify-center">
          <LegendItem tier="D1" count={counts.D1} you={meStanding?.tier === "D1"} />
          <LegendItem tier="D2" count={counts.D2} you={meStanding?.tier === "D2"} />
          <LegendItem tier="D3" count={counts.D3} you={meStanding?.tier === "D3"} />
        </div>
      </div>

      {/* Viewer band（自分のサマリ） */}
      {me && meStanding && (
        <div className="flex items-center gap-3 rounded-[16px] border border-[#eceff1] bg-white px-[14px] py-3">
          <div className="relative shrink-0">
            <Avatar src={meStanding.pictureUrl} name={meStanding.displayName} size={44} />
            <span
              className="absolute -bottom-0.5 -right-0.5 grid place-items-center rounded-[9px] border-2 border-white text-[10px] font-black text-white"
              style={{ width: 18, height: 18, background: TIER[me.tier].color }}
            >
              {me.rank}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-bold text-[#1c1f21] truncate">{meStanding.displayName}</span>
              <span className="shrink-0 rounded-[6px] px-1.5 py-0.5 text-[10.5px] font-bold" style={{ color: TIER[me.tier].color, background: `color-mix(in srgb, ${TIER[me.tier].color} 12%, #fff)` }}>
                {me.tier} {me.rank}位
              </span>
            </div>
            <div className="text-[12px] text-[#97999d] mt-0.5">
              {me.gapToD1 > 0 ? (
                <><span className="text-[#40434a]">D1昇格まで</span> <span className="font-bold text-[#5f7a80]">+{me.gapToD1}pt</span></>
              ) : (
                <span className="text-[#40434a]">D1リーグ在籍中</span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end shrink-0">
            <span className="text-[18px] font-black text-[#1c1f21] tabular-nums">{me.totalPt}</span>
            <span className="text-[10px] text-[#97999d]">通算pt ・ 出場 {me.games}回</span>
          </div>
        </div>
      )}

      {/* Rankings（D1 / D2 / D3） */}
      {standings.length === 0 ? (
        <div className="rounded-[14px] border border-[#eceff1] bg-white p-8 text-center text-sm text-[#231714]/70">まだ順位データがありません</div>
      ) : (
        <div className="flex flex-col gap-[18px]">
          {(["D1", "D2", "D3"] as Tier[]).map((tier) => {
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
                  <RankRow key={s.rank} s={s} tierColor={TIER[tier].color} />
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* 開催フォーマット */}
      <div className="rounded-[14px] border border-[#eceff1] bg-white px-[14px] pt-3 pb-[14px] flex flex-col gap-1.5">
        <div className="text-[10px] font-bold tracking-[0.14em] text-[#97999d]">開催フォーマット</div>
        <div className="text-[12.5px] font-bold text-[#40434a] leading-[1.5]">1開催 8名 ・ ゼロワン → カウントアップ → クリケット</div>
        <div className="text-[11px] text-[#97999d] leading-[1.5]">クリケットは2名1組で対戦 ・ 各ゲームの着順をptに換算</div>
      </div>

      {/* 脚注 */}
      <p className="px-0.5 text-[11px] text-[#97999d] leading-[1.6]">
        順位は各ゲームの着順ptを通算。同ptの場合は1位回数 → 出場数 → 名前順。
      </p>
    </div>
  );
}

function LegendItem({ tier, count, you }: { tier: Tier; count: number; you: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-block rotate-45 rounded-[3px]" style={{ width: 11, height: 11, background: TIER[tier].color }} />
      <span className="text-[11px] font-bold text-white/95">{tier}</span>
      <span className="text-[11px] text-white/60">
        {count}名{you && <span className="font-black" style={{ color: "#e8ce86" }}> ・ あなた</span>}
      </span>
    </div>
  );
}

function RankRow({ s, tierColor }: { s: Standing; tierColor: string }) {
  const topThree = s.rank <= 3;
  return (
    <div
      className="flex items-center gap-2.5 rounded-[14px] px-3 py-2.5"
      style={
        s.isMe
          ? { border: `1.5px solid ${tierColor}`, background: `color-mix(in srgb, ${tierColor} 8%, #fff)` }
          : { border: "1px solid #eceff1", background: "#fff" }
      }
    >
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
    </div>
  );
}

/** 累積ptの推移スパークライン（開催日順）。1点以下はプレースホルダ。 */
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

/* ───────── ダーツボード（同心リング＝D1/D2/D3）＋自分の位置 ───────── */

function DartBoard({ meTier, meName }: { meTier: Tier | null; meName?: string }) {
  const C = 132; // center
  // リング半径（外→内）: D3 gold / D2 cyan / D1 magenta。
  const rD3 = 108, rD2 = 75, rD1 = 46;
  const wD3 = 30, wD2 = 32;
  const spokes = Array.from({ length: 16 }, (_, i) => (i * Math.PI * 2) / 16);
  // 自分の位置（tierのリング上・右上）。
  const meRadius = meTier === "D1" ? 24 : meTier === "D2" ? rD2 : rD3;
  const meAngle = (-52 * Math.PI) / 180;
  const meX = C + meRadius * Math.cos(meAngle);
  const meY = C + meRadius * Math.sin(meAngle);
  const meColor = meTier ? TIER[meTier].color : "#1172a5";

  return (
    <svg viewBox="0 0 264 264" className="w-[240px] max-w-full h-auto" role="img" aria-label="ダーツリーグ ボード">
      {/* 外周リング（board枠） */}
      <circle cx={C} cy={C} r={126} fill="#111315" stroke="rgba(255,255,255,0.06)" />
      {/* D3 gold band */}
      <circle cx={C} cy={C} r={rD3} fill="none" stroke={TIER.D3.color} strokeWidth={wD3} opacity={0.9} />
      {/* D2 cyan band */}
      <circle cx={C} cy={C} r={rD2} fill="none" stroke={TIER.D2.color} strokeWidth={wD2} opacity={0.92} />
      {/* D1 magenta disc */}
      <circle cx={C} cy={C} r={rD1} fill={TIER.D1.color} />
      {/* セグメントのスポーク（ダーツボード風） */}
      {spokes.map((a, i) => (
        <line
          key={i}
          x1={C + 30 * Math.cos(a)} y1={C + 30 * Math.sin(a)}
          x2={C + 124 * Math.cos(a)} y2={C + 124 * Math.sin(a)}
          stroke="rgba(0,0,0,0.28)" strokeWidth={1}
        />
      ))}
      {/* bull（中心） */}
      <circle cx={C} cy={C} r={16} fill="#141618" stroke="rgba(255,255,255,0.18)" />
      {/* tier ラベル */}
      <text x={C} y={C + 4} textAnchor="middle" className="fill-white" style={{ font: "700 11px 'Noto Sans JP', sans-serif" }}>D1</text>
      <text x={C} y={C - rD2 + 4} textAnchor="middle" className="fill-white" style={{ font: "700 10px 'Noto Sans JP', sans-serif" }}>D2</text>
      <text x={C} y={C - rD3 + 4} textAnchor="middle" className="fill-white" style={{ font: "700 10px 'Noto Sans JP', sans-serif" }}>D3</text>

      {/* 自分の位置（コネクタ＋アバター） */}
      {meTier && (
        <>
          <line x1={C} y1={C} x2={meX} y2={meY} stroke="rgba(255,255,255,0.5)" strokeWidth={1.5} />
          <circle cx={C} cy={C} r={3} fill="#fff" />
          <circle cx={meX} cy={meY} r={16} fill={meColor} stroke="#fff" strokeWidth={2} />
          <text x={meX} y={meY + 4.5} textAnchor="middle" className="fill-white" style={{ font: "900 13px 'Noto Sans JP', sans-serif" }}>
            {meName?.charAt(0) ?? "あ"}
          </text>
        </>
      )}
    </svg>
  );
}
