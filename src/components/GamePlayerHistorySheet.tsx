"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/LineContact";
import { BottomSheet } from "@/components/ui/Sheet";

/**
 * 汎用スコアボード（darts / poker / billiards）のプレイヤー戦歴シート。
 * 麻雀 PlayerHistorySheet と同じ基本UI（ヘッダ＋集計＋pt推移＋対戦リスト）。
 * データは GET /api/games/players/[lineUserId]/history?gameCategory=。
 */

interface HistGame { date: string; pt: number; label: string; isFirst: boolean }
interface Summary { games: number; totalPt: number; avgPt: number; rank: number; firsts: number }
interface HistoryData {
  player: { displayName: string; pictureUrl?: string } | null;
  summary: Summary | null;
  trend: number[];
  games: HistGame[];
}

function fmtDate(d: string): string {
  if (!d) return "";
  const [, m, day] = d.split("-").map(Number);
  const w = ["日", "月", "火", "水", "木", "金", "土"][new Date(d + "T00:00:00").getDay()];
  return `${m}/${day}(${w})`;
}

function Sparkline({ points, accent }: { points: number[]; accent: string }) {
  if (points.length < 2) return null;
  const w = 280, h = 56, pad = 5;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const xs = (i: number) => pad + (i / (points.length - 1)) * (w - 2 * pad);
  const ys = (v: number) => pad + (1 - (v - min) / span) * (h - 2 * pad);
  const d = points.map((v, i) => `${i === 0 ? "M" : "L"}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: h }} preserveAspectRatio="none">
      <path d={d} fill="none" stroke={accent} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((v, i) => (<circle key={i} cx={xs(i)} cy={ys(v)} r={2.2} fill={accent} />))}
    </svg>
  );
}

export function GamePlayerHistorySheet({
  lineUserId,
  gameCategory,
  seasonId,
  accent = "#2f7d57",
  onClose,
}: {
  lineUserId: string;
  gameCategory: string;
  seasonId?: string;
  accent?: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const params = new URLSearchParams({ gameCategory });
    if (seasonId) params.set("seasonId", seasonId);
    fetch(`/api/games/players/${encodeURIComponent(lineUserId)}/history?${params}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { if (alive) { setData(d); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [lineUserId, gameCategory, seasonId]);

  return (
    <BottomSheet open onClose={onClose}>
      {loading ? (
        <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" /></div>
      ) : !data || !data.player ? (
        <div className="py-10 text-center text-sm text-[#231714]/80">戦歴を取得できませんでした</div>
      ) : (
        <>
          {/* ヘッダー */}
          <div className="flex items-center gap-3">
            <Avatar src={data.player.pictureUrl} name={data.player.displayName} size={48} />
            <div className="min-w-0 flex-1">
              <div className="text-base font-bold text-[#1c1f21] truncate">{data.player.displayName}</div>
              {data.summary ? (
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[11px] font-extrabold px-2 py-0.5 rounded-full text-white" style={{ background: accent }}>通算 {data.summary.rank}位</span>
                </div>
              ) : (
                <div className="text-[12px] text-[#3f4247] mt-1">このシーズンの戦歴なし</div>
              )}
            </div>
          </div>

          {data.summary && (
            <>
              <div className="grid grid-cols-4 gap-2 mt-4">
                {[
                  { label: "戦数", val: `${data.summary.games}` },
                  { label: "通算pt", val: data.summary.totalPt.toLocaleString() },
                  { label: "平均pt", val: data.summary.avgPt.toLocaleString() },
                  { label: "1位", val: `${data.summary.firsts}回` },
                ].map((c) => (
                  <div key={c.label} className="rounded-xl bg-[#f6f8f9] py-2.5 text-center">
                    <div className="text-[15px] font-black text-[#1c1f21] tabular-nums">{c.val}</div>
                    <div className="text-[10px] text-[#3f4247] mt-0.5">{c.label}</div>
                  </div>
                ))}
              </div>

              {data.trend.length >= 2 && (
                <div className="mt-4">
                  <div className="text-[11px] font-extrabold text-[#3f4247] mb-1.5">通算pt推移</div>
                  <div className="rounded-xl bg-[#f6f8f9] px-2 py-2"><Sparkline points={data.trend} accent={accent} /></div>
                </div>
              )}

              <div className="mt-4">
                <div className="text-[11px] font-extrabold text-[#3f4247] mb-1.5">戦歴（{data.games.length}戦）</div>
                <div className="flex flex-col gap-1.5">
                  {data.games.map((g, i) => (
                    <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-xl" style={{ background: "#fff", boxShadow: "inset 0 0 0 1px #f1f3f4" }}>
                      <span className="text-[12px] font-bold text-[#1c1f21] tabular-nums w-[70px]">{fmtDate(g.date)}</span>
                      <span className="text-[11px] font-bold" style={{ color: g.isFirst ? accent : "#3f4247" }}>{g.label}</span>
                      <span className="flex-1" />
                      <span className="text-[14px] font-black tabular-nums text-[#1c1f21]">{g.pt.toLocaleString()}</span>
                      <span className="text-[10px] font-bold text-[#97999d]">pt</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </BottomSheet>
  );
}
