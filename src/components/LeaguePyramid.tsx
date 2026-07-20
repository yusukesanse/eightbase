"use client";

import dynamic from "next/dynamic";
import type { MahjongStanding, MahjongLeagueTier } from "@/types";
import { Avatar } from "@/components/ui/LineContact";

/**
 * 麻雀リーグ ピラミッド表示（TILES 案）
 * - 上部: 3D 回転ピラミッド（`LeaguePyramid3D`）をアイボリー帯のヒーローに配置
 * - 下部: M1/M2/M3 別の順位リスト（自分を YOU でハイライト）
 */

// 3D は WebGL のためクライアント専用（SSR 無効）
const LeaguePyramid3D = dynamic(
  () => import("./LeaguePyramid3D").then((m) => m.LeaguePyramid3D),
  { ssr: false }
);

const TIER_META: Record<MahjongLeagueTier, { color: string; desc: string }> = {
  M1: { color: "#a2125a", desc: "PREMIER ・ 1〜4位" },
  M2: { color: "#1172a5", desc: "CHALLENGER ・ 5〜8位" },
  M3: { color: "#b48f13", desc: "CONTENDER ・ 9位〜" },
};

const TIER_ORDER: MahjongLeagueTier[] = ["M1", "M2", "M3"];

/** 連対率の表示（0–1 の小数でも 0–100 でも % 表記・小数第2位まで） */
function pct(v: number): string {
  if (v == null || Number.isNaN(v)) return "0.00%";
  const n = v <= 1 ? v * 100 : v;
  return `${n.toFixed(2)}%`;
}

export function LeaguePyramid({
  standings,
  currentUserId,
  onSelectPlayer,
  rankingMetric = "average",
}: {
  standings: MahjongStanding[];
  currentUserId?: string;
  /** 順位リストの行タップ（戦歴ビューを開く） */
  onSelectPlayer?: (lineUserId: string) => void;
  /** 順位方式（"average" | "total"）。順位キーの強調と注記に使う。 */
  rankingMetric?: "average" | "total";
}) {
  const byTotal = rankingMetric === "total";
  const byTier: Record<MahjongLeagueTier, MahjongStanding[]> = { M1: [], M2: [], M3: [] };
  standings.forEach((s) => byTier[s.tier].push(s));
  TIER_ORDER.forEach((t) => byTier[t].sort((a, b) => a.rank - b.rank));

  return (
    <div className="space-y-5">
      {/* 3D ピラミッド（黒帯ヒーロー・ダーツ LEAGUE BOARD と背景色を統一 #17191b） */}
      <div
        className="rounded-[18px] overflow-hidden"
        style={{ background: "radial-gradient(120% 80% at 50% 12%, #202226, #17191b)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)" }}
      >
        <LeaguePyramid3D standings={standings} currentUserId={currentUserId} height={280} />
      </div>

      {/* 順位リスト */}
      <div className="space-y-[18px]">
        {TIER_ORDER.map((t) => {
          const members = byTier[t];
          if (members.length === 0) return null;
          const col = TIER_META[t].color;
          return (
            <div key={`list-${t}`}>
              {/* セクション見出し */}
              <div className="flex items-center gap-2 mx-0.5 mb-2">
                <span className="text-[13px] font-black tracking-wide" style={{ color: col }}>{t}</span>
                <span className="text-[11px] text-[#3f4247]">{TIER_META[t].desc}</span>
                <span className="flex-1 h-px bg-[#eceff1]" />
                <span className="text-[11px] text-[#3f4247]">{members.length}名</span>
              </div>

              <div className="flex flex-col gap-2">
                {members.map((s) => {
                  const isMe = s.lineUserId === currentUserId;
                  const top3 = s.rank <= 3;
                  return (
                    <button
                      key={s.lineUserId}
                      type="button"
                      onClick={() => onSelectPlayer?.(s.lineUserId)}
                      className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-[14px] active:scale-[0.99] transition-transform"
                      style={
                        isMe
                          ? { background: `color-mix(in srgb, ${col} 8%, #fff)`, boxShadow: `inset 0 0 0 1.5px ${col}` }
                          : { background: "#fff", boxShadow: "0 1px 2px rgba(28,31,33,.05), inset 0 0 0 1px #f1f3f4" }
                      }
                    >
                      <div className="w-[26px] text-center shrink-0">
                        <span
                          className="font-black tabular-nums"
                          style={{ fontSize: top3 ? 19 : 16, color: top3 ? col : "#3f4247", letterSpacing: "-.03em" }}
                        >
                          {s.rank}
                        </span>
                      </div>
                      <Avatar src={s.pictureUrl} name={s.displayName} size={36} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[14.5px] font-bold text-[#1c1f21] truncate">
                          {s.displayName}
                          {isMe && (
                            <span className="ml-1.5 text-[10px] font-extrabold" style={{ color: col }}>YOU</span>
                          )}
                        </div>
                        <div className="flex gap-2.5 mt-0.5 text-[11px] text-[#3f4247] tabular-nums">
                          <span>{s.gamesPlayed}戦</span>
                          <span>1位 {s.firstCount}</span>
                          <span>連対 {pct(s.top2Rate)}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0 min-w-[64px]">
                        <div className="text-[16.5px] font-black text-[#1c1f21] tabular-nums leading-none">
                          {byTotal
                            ? s.totalPoints.toLocaleString()
                            : Math.round(s.average).toLocaleString()}
                        </div>
                        <div className="text-[9.5px] font-bold text-[#3f4247] mt-0.5">
                          {byTotal ? "合計点" : "AVG"}
                        </div>
                        <div className="text-[10px] text-[#3f4247] tabular-nums mt-0.5">
                          {byTotal
                            ? `AVG ${Math.round(s.average).toLocaleString()}`
                            : `計 ${s.totalPoints.toLocaleString()}`}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-[#3f4247] leading-relaxed px-1">
        順位はシーズン通算{byTotal ? "合計点" : "アベレージ"}順。同点の場合は 連対率 → 試合数 → 名前順。毎月のリーグ戦後にリーグの入れ替えがあります。
      </p>
    </div>
  );
}
