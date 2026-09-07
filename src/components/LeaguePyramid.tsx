"use client";

import type { MahjongStanding, MahjongLeagueTier } from "@/types";
import { Avatar } from "@/components/ui/LineContact";
import { GlassCard, StatusPill } from "@/components/ui/eb";
import { LeaguePyramidHero } from "@/components/LeaguePyramidHero";

/**
 * 麻雀リーグ ピラミッド表示
 * - 上部: クリスタル・ピラミッドの画像（`public/league-pyramid.jpg`・M1=マゼンタ／M2=ブルー／M3=ゴールド）を
 *   黒のヒーローカードに置き、左に段ラベル、右に自分の位置（アバター＋「あなた」）を重ねる。
 *   ※ 2026-09-07 に Three.js の 3D ピラミッド（`LeaguePyramid3D`）から差し替え。ファイルは残してあるが未使用。
 * - 下部: M1/M2/M3 別の順位リスト（自分を YOU でハイライト）
 */

const TIER_META: Record<MahjongLeagueTier, { color: string; desc: string }> = {
  M1: { color: "var(--eb-league-m1)", desc: "PREMIER ・ 1〜4位" },
  M2: { color: "var(--eb-league-m2)", desc: "CHALLENGER ・ 5〜8位" },
  M3: { color: "var(--eb-league-m3)", desc: "CONTENDER ・ 9位〜" },
};

const TIER_ORDER = ["M1", "M2", "M3"] as const satisfies readonly MahjongLeagueTier[];


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
  const me = currentUserId ? standings.find((s) => s.lineUserId === currentUserId) : undefined;

  return (
    <div className="space-y-5">
      {/* ピラミッド（4種目共通のヒーロー） */}
      <LeaguePyramidHero
        tierKeys={TIER_ORDER}
        counts={[byTier.M1.length, byTier.M2.length, byTier.M3.length]}
        me={me ? { tierIndex: TIER_ORDER.indexOf(me.tier), displayName: me.displayName, pictureUrl: me.pictureUrl } : undefined}
      />

      {/* 順位リスト */}
      <div className="space-y-4">
        {TIER_ORDER.map((t) => {
          const members = byTier[t];
          if (members.length === 0) return null;
          const col = TIER_META[t].color;
          return (
            <GlassCard key={`list-${t}`}>
              {/* セクション見出し */}
              <div className="flex items-center gap-2 mb-3">
                <span
                  className="inline-flex items-center rounded-lg px-2 py-1 text-[13px] font-bold text-white"
                  style={{ background: col }}
                >
                  {t}
                </span>
                <span className="text-[12px] text-[color:var(--eb-ink-muted)]">{TIER_META[t].desc}</span>
                <span className="flex-1" />
                <span className="text-[12px] text-[color:var(--eb-ink-muted)]">{members.length}名</span>
              </div>

              <div className="flex flex-col gap-2">
                {members.map((s) => {
                  const isMe = s.lineUserId === currentUserId;
                  return (
                    <button
                      key={s.lineUserId}
                      type="button"
                      onClick={() => onSelectPlayer?.(s.lineUserId)}
                      className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-[14px] active:scale-[0.99] transition-transform"
                      style={
                        isMe
                          ? { background: "rgba(35,147,94,.12)", boxShadow: "inset 0 0 0 1.5px var(--eb-green)" }
                          : { background: "transparent" }
                      }
                    >
                      <div className="w-[26px] text-center shrink-0">
                        <span
                          className="text-[17px] font-bold tabular-nums"
                          style={{ color: "rgba(26,29,27,.6)", letterSpacing: "-.03em" }}
                        >
                          {s.rank}
                        </span>
                      </div>
                      <Avatar src={s.pictureUrl} name={s.displayName} size={32} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 text-[15px] font-bold text-[color:var(--eb-ink)] truncate">
                          {s.displayName}
                          {isMe && <StatusPill tone="green">YOU</StatusPill>}
                        </div>
                        <div className="flex gap-2.5 mt-0.5 text-[12px] text-[color:var(--eb-ink-muted)] tabular-nums">
                          <span>{s.gamesPlayed}戦</span>
                          <span>1位 {s.firstCount}</span>
                          <span>連対 {pct(s.top2Rate)}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0 min-w-[64px]">
                        <div className="text-[17px] font-bold text-[color:var(--eb-ink)] tabular-nums leading-none">
                          {byTotal
                            ? s.totalPoints.toLocaleString()
                            : Math.round(s.average).toLocaleString()}
                        </div>
                        <div className="text-[10px] font-bold text-[color:var(--eb-ink-muted)] mt-0.5">
                          {byTotal ? "合計点" : "AVG"}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </GlassCard>
          );
        })}
      </div>

      <p className="text-[12px] text-[color:var(--eb-ink-muted)] leading-relaxed px-1">
        順位はシーズン通算{byTotal ? "合計点" : "アベレージ"}順。同点の場合は 連対率 → 試合数 → 名前順。毎月のリーグ戦後にリーグの入れ替えがあります。
      </p>
    </div>
  );
}
