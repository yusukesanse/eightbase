"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/LineContact";
import type { MahjongPlayerHistory, MahjongLeagueTier } from "@/types";

const TIER_COLOR: Record<MahjongLeagueTier, string> = {
  M1: "#a2125a",
  M2: "#1172a5",
  M3: "#b48f13",
};
const ACCENT = "#2f7d57";

function pct(v: number): string {
  if (v == null || Number.isNaN(v)) return "0%";
  const n = v <= 1 ? v * 100 : v;
  return `${Math.round(n)}%`;
}

/** 連対率の表示（小数第2位まで） */
function pct2(v: number): string {
  if (v == null || Number.isNaN(v)) return "0.00%";
  const n = v <= 1 ? v * 100 : v;
  return `${n.toFixed(2)}%`;
}

function fmtDate(d: string): string {
  const [, m, day] = d.split("-").map(Number);
  const w = ["日", "月", "火", "水", "木", "金", "土"][new Date(d + "T00:00:00").getDay()];
  return `${m}/${day}(${w})`;
}

function rankColor(rank: number): string {
  if (rank === 1) return "#d8a526";
  if (rank === 2) return "#8a9298";
  if (rank === 4) return "#c0563c";
  return "#1c1f21";
}

/** AVG推移スパークライン（累積アベレージの折れ線） */
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const w = 280;
  const h = 56;
  const pad = 5;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const xs = (i: number) => pad + (i / (points.length - 1)) * (w - 2 * pad);
  const ys = (v: number) => pad + (1 - (v - min) / span) * (h - 2 * pad);
  const d = points
    .map((v, i) => `${i === 0 ? "M" : "L"}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: h }} preserveAspectRatio="none">
      <path d={d} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((v, i) => (
        <circle key={i} cx={xs(i)} cy={ys(v)} r={2.2} fill={ACCENT} />
      ))}
    </svg>
  );
}

/**
 * プレイヤー戦歴ビュー（ボトムシート）
 * 順位リストのタップから開く。選択中シーズンの戦歴を表示。
 */
export function PlayerHistorySheet({
  lineUserId,
  seasonId,
  onClose,
}: {
  lineUserId: string;
  seasonId?: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<MahjongPlayerHistory | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const q = seasonId ? `?seasonId=${encodeURIComponent(seasonId)}` : "";
    fetch(`/api/mahjong/players/${encodeURIComponent(lineUserId)}/history${q}`, {
      credentials: "include",
    })
      .then((r) => r.json())
      .then((d) => {
        if (alive) {
          setData(d);
          setLoading(false);
        }
      })
      .catch(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [lineUserId, seasonId]);

  const tierColor = data?.standing ? TIER_COLOR[data.standing.tier] : "#97999d";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-md p-5 safe-area-pb max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !data ? (
          <div className="py-10 text-center text-sm text-[#231714]/40">
            戦歴を取得できませんでした
          </div>
        ) : (
          <>
            {/* ヘッダー */}
            <div className="flex items-center gap-3">
              <Avatar src={data.player.pictureUrl} name={data.player.displayName} size={48} />
              <div className="min-w-0 flex-1">
                <div className="text-base font-bold text-[#1c1f21] truncate">
                  {data.player.displayName}
                </div>
                {data.standing ? (
                  <div className="flex items-center gap-1.5 mt-1">
                    <span
                      className="text-[11px] font-extrabold px-2 py-0.5 rounded-full text-white"
                      style={{ background: tierColor }}
                    >
                      {data.standing.tier}
                    </span>
                    <span className="text-[12px] font-bold text-[#97999d]">
                      {data.standing.rank}位
                    </span>
                  </div>
                ) : (
                  <div className="text-[12px] text-[#97999d] mt-1">このシーズンの戦歴なし</div>
                )}
              </div>
            </div>

            {data.standing && (
              <>
                {/* 集計 */}
                <div className="grid grid-cols-4 gap-2 mt-4">
                  {[
                    { label: "戦数", val: `${data.standing.gamesPlayed}` },
                    { label: "AVG", val: Math.round(data.standing.average).toLocaleString() },
                    { label: "1位率", val: pct(data.standing.firstRate) },
                    { label: "連対率", val: pct2(data.standing.top2Rate) },
                  ].map((c) => (
                    <div key={c.label} className="rounded-xl bg-[#f6f8f9] py-2.5 text-center">
                      <div className="text-[15px] font-black text-[#1c1f21] tabular-nums">{c.val}</div>
                      <div className="text-[10px] text-[#97999d] mt-0.5">{c.label}</div>
                    </div>
                  ))}
                </div>

                {/* AVG推移スパークライン */}
                {data.avgTrend.length >= 2 && (
                  <div className="mt-4">
                    <div className="text-[11px] font-extrabold text-[#97999d] mb-1.5">AVG推移</div>
                    <div className="rounded-xl bg-[#f6f8f9] px-2 py-2">
                      <Sparkline points={data.avgTrend.map((p) => p.cumulativeAverage)} />
                    </div>
                  </div>
                )}

                {/* 戦歴リスト */}
                <div className="mt-4">
                  <div className="text-[11px] font-extrabold text-[#97999d] mb-1.5">
                    戦歴（{data.games.length}戦）
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {data.games.map((g) => (
                      <div
                        key={g.tableId}
                        className="flex items-center gap-2.5 px-3 py-2 rounded-xl"
                        style={{ background: "#fff", boxShadow: "inset 0 0 0 1px #f1f3f4" }}
                      >
                        <span className="text-[12px] font-bold text-[#1c1f21] tabular-nums w-[64px]">
                          {fmtDate(g.eventDate)}
                        </span>
                        {g.round ? (
                          <span className="text-[10px] text-[#97999d]">第{g.round}回戦</span>
                        ) : null}
                        <span className="flex-1" />
                        <span className="text-[14px] font-black tabular-nums text-[#1c1f21]">
                          {g.points.toLocaleString()}
                        </span>
                        <span
                          className="text-[12px] font-extrabold w-[34px] text-right"
                          style={{ color: rankColor(g.rank) }}
                        >
                          {g.rank}着
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            <button
              onClick={onClose}
              className="mt-5 w-full py-3 text-sm font-bold text-[#40434a] bg-white rounded-2xl"
              style={{ boxShadow: "inset 0 0 0 1px #e4e7e9" }}
            >
              閉じる
            </button>
          </>
        )}
      </div>
    </div>
  );
}
