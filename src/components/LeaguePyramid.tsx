"use client";

import Image from "next/image";
import type { MahjongStanding, MahjongLeagueTier } from "@/types";
import { Avatar } from "@/components/ui/LineContact";
import { GlassCard, StatusPill } from "@/components/ui/eb";

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

const TIER_ORDER: MahjongLeagueTier[] = ["M1", "M2", "M3"];

/** ヒーローの高さ（旧 3D 版と同じ）。 */
const HERO_HEIGHT = 280;
/** 左ラベルの縦位置（上端からの割合・旧 3D 版と同じ定数）。画像を差し替えたらここを合わせる。 */
const LABEL_TOP = [0.07, 0.37, 0.645] as const;
/** 自分のアバターの縦位置（各段の面の中心・上端からの割合）。画像を差し替えたらここを合わせる。 */
const AVATAR_TOP = [0.12, 0.46, 0.73] as const;
/** ピラミッド画像を中央から右へずらす量（px）。左のラベルと重ならないようにする。 */
const PYRAMID_OFFSET_X = 22;
/** 左ラベルのキッカー（段位置で固定・旧 3D 版と同じ）。 */
const KICKER = ["PREMIER", "CHALLENGER", "CONTENDER"] as const;
const GOLD = "linear-gradient(180deg,#f9ead0,#e6bd52 42%,#c9962a 70%,#a9781a)";

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
      {/* クリスタル・ピラミッド（黒のヒーローカード）。ラベルとアバターは旧 3D 版と同じ表現:
          左固定のゴールド箔風セリフ体ラベル＋自分のアバターが「あなた」フラッグ付きで浮遊する。 */}
      <div
        className="relative overflow-hidden rounded-[20px]"
        style={{
          background: "#000000",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08), 0 8px 24px rgba(20,41,31,.12)",
          height: HERO_HEIGHT,
        }}
        aria-label="リーグのピラミッド"
      >
        {/* 画像は静止（アニメーションなし・ユーザー指示） */}
        <div className="absolute inset-y-2 left-1/2 aspect-square -translate-x-1/2" style={{ marginLeft: PYRAMID_OFFSET_X }}>
          <Image
            src="/league-pyramid.jpg"
            alt=""
            fill
            sizes="(max-width: 480px) 90vw, 320px"
            priority
            className="object-contain"
          />
        </div>

        {/* 左固定ラベル（ゴールド箔風セリフ体・旧 3D 版と同じ） */}
        <div className="pointer-events-none absolute inset-0">
          {TIER_ORDER.map((t, i) => {
            const col = TIER_META[t].color;
            const meHere = me?.tier === t;
            return (
              <div key={t} style={{ position: "absolute", left: 12, top: `${LABEL_TOP[i] * 100}%`, display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 14, height: 14, borderRadius: 3, transform: "rotate(45deg)", background: `linear-gradient(135deg, rgba(255,255,255,.85), ${col})`, boxShadow: `inset 0 0 0 1px rgba(255,255,255,.4), 0 0 0 1px ${col}, 0 0 ${meHere ? 14 : 5}px ${meHere ? col : "rgba(0,0,0,.12)"}` }} />
                <div style={{ lineHeight: 1.05 }}>
                  <div style={{ fontFamily: "'Noto Serif JP', serif", fontSize: 9.5, fontWeight: 600, letterSpacing: ".22em", background: GOLD, WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", color: "transparent" }}>{KICKER[i]}</div>
                  <div style={{ fontFamily: "'Noto Serif JP', serif", fontSize: 33, fontWeight: 900, letterSpacing: "-.01em", marginTop: 1,
                    background: `linear-gradient(168deg, #ffffff 8%, ${col} 62%, color-mix(in srgb, ${col} 60%, #5a0f33) 100%)`,
                    WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", color: "transparent",
                    filter: `drop-shadow(0 1px 0 rgba(255,255,255,.6)) drop-shadow(0 2px 3px rgba(40,20,10,.28)) drop-shadow(0 0 ${meHere ? 11 : 0}px ${col})` }}>{t}</div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: meHere ? col : "rgba(255,255,255,.55)", marginTop: 3 }}>{byTier[t].length}名{meHere ? " ・ あなた" : ""}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* 自分のアバター: ピラミッドの上（所属する段の面の中央）に重ねる。「あなた」フラッグ付きでゆっくり浮遊 */}
        {me && (
          <div
            className="eb-pyramid-float pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
            style={{ left: `calc(50% + ${PYRAMID_OFFSET_X}px)`, top: `${AVATAR_TOP[TIER_ORDER.indexOf(me.tier)] * 100}%` }}
          >
            <span
              className="mb-1 rounded-full px-2.5 py-[3px] text-[11px] font-bold text-[color:var(--eb-ink)]"
              style={{ background: GOLD, boxShadow: "0 2px 6px rgba(0,0,0,.35)" }}
            >
              あなた
            </span>
            <div className="rounded-full p-[3px]" style={{ background: `linear-gradient(135deg, rgba(255,255,255,.9), ${TIER_META[me.tier].color})`, boxShadow: `0 0 18px ${TIER_META[me.tier].color}` }}>
              <div className="rounded-full bg-black p-[2px]">
                <Avatar src={me.pictureUrl} name={me.displayName} size={44} />
              </div>
            </div>
          </div>
        )}
      </div>

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
