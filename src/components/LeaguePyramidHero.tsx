"use client";

import Image from "next/image";
import { Avatar } from "@/components/ui/LineContact";
import { cssColor, type TierKeys } from "@/components/LeaguePyramid3D";

/**
 * リーグのピラミッド（4種目共通のヒーロー）。
 * - クリスタル・ピラミッドの画像（`public/league-pyramid.jpg`・上段マゼンタ／中段ブルー／下段ゴールド）を
 *   純黒（画像の背景と同じ）のカードに置く。**画像自体は動かさない（ユーザー指示）。**
 * - 左固定のゴールド箔風セリフ体ラベル（PREMIER / CHALLENGER / CONTENDER・段名・人数・あなた）。
 * - 自分のアバターは所属する段の面の中央（画像の上）に「あなた」フラッグ付きで重ね、ゆっくり浮遊する。
 * 種目差は tierKeys（M1/D1/B1/P1…）だけ。配色と位置は全種目共通なのでここで一元管理する。
 * ※ 2026-09-07 に Three.js の `LeaguePyramid3D` から差し替え。3D は未使用で残置。
 */

/** ヒーローの高さ（旧 3D 版と同じ）。 */
export const HERO_HEIGHT = 280;
/** 左ラベルの縦位置（上端からの割合・旧 3D 版と同じ定数）。画像を差し替えたらここを合わせる。 */
const LABEL_TOP = [0.07, 0.37, 0.645] as const;
/** 自分のアバターの縦位置（各段の面の中心・上端からの割合）。 */
const AVATAR_TOP = [0.12, 0.46, 0.73] as const;
/** ピラミッド画像を中央から右へずらす量（px）。左のラベルと重ならないようにする。 */
const PYRAMID_OFFSET_X = 22;
const KICKER = ["PREMIER", "CHALLENGER", "CONTENDER"] as const;
const GOLD = "linear-gradient(180deg,#f9ead0,#e6bd52 42%,#c9962a 70%,#a9781a)";

export interface LeaguePyramidHeroProps {
  /** 3階層のラベル（上位→下位）。例: ["M1","M2","M3"] / ["D1","D2","D3"] */
  tierKeys: TierKeys;
  /** 各段の人数（上位→下位）。 */
  counts: readonly [number, number, number];
  /** 自分（所属する段の index 0〜2）。未参加なら undefined。 */
  me?: { tierIndex: number; displayName: string; pictureUrl?: string };
  ariaLabel?: string;
}

export function LeaguePyramidHero({ tierKeys, counts, me, ariaLabel = "リーグのピラミッド" }: LeaguePyramidHeroProps) {
  return (
    <div
      className="relative overflow-hidden rounded-[20px]"
      style={{
        background: "#000000",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08), 0 8px 24px rgba(20,41,31,.12)",
        height: HERO_HEIGHT,
      }}
      aria-label={ariaLabel}
    >
      {/* 画像は静止 */}
      <div className="absolute inset-y-2 left-1/2 aspect-square -translate-x-1/2" style={{ marginLeft: PYRAMID_OFFSET_X }}>
        <Image src="/league-pyramid.jpg" alt="" fill sizes="(max-width: 480px) 90vw, 320px" priority className="object-contain" />
      </div>

      {/* 左固定ラベル（ゴールド箔風セリフ体） */}
      <div className="pointer-events-none absolute inset-0">
        {tierKeys.map((t, i) => {
          const col = cssColor(i);
          const meHere = me?.tierIndex === i;
          return (
            <div key={t} style={{ position: "absolute", left: 12, top: `${LABEL_TOP[i] * 100}%`, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 14, height: 14, borderRadius: 3, transform: "rotate(45deg)", background: `linear-gradient(135deg, rgba(255,255,255,.85), ${col})`, boxShadow: `inset 0 0 0 1px rgba(255,255,255,.4), 0 0 0 1px ${col}, 0 0 ${meHere ? 14 : 5}px ${meHere ? col : "rgba(0,0,0,.12)"}` }} />
              <div style={{ lineHeight: 1.05 }}>
                <div style={{ fontFamily: "'Noto Serif JP', serif", fontSize: 9.5, fontWeight: 600, letterSpacing: ".22em", background: GOLD, WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", color: "transparent" }}>{KICKER[i]}</div>
                <div style={{ fontFamily: "'Noto Serif JP', serif", fontSize: 33, fontWeight: 900, letterSpacing: "-.01em", marginTop: 1,
                  background: `linear-gradient(168deg, #ffffff 8%, ${col} 62%, color-mix(in srgb, ${col} 60%, #5a0f33) 100%)`,
                  WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", color: "transparent",
                  filter: `drop-shadow(0 1px 0 rgba(255,255,255,.6)) drop-shadow(0 2px 3px rgba(40,20,10,.28)) drop-shadow(0 0 ${meHere ? 11 : 0}px ${col})` }}>{t}</div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: meHere ? col : "rgba(255,255,255,.55)", marginTop: 3 }}>{counts[i]}名{meHere ? " ・ あなた" : ""}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 自分のアバター: ピラミッドの上（所属する段の面の中央）。「あなた」フラッグ付きでゆっくり浮遊 */}
      {me && (
        <div
          className="eb-pyramid-float pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
          style={{ left: `calc(50% + ${PYRAMID_OFFSET_X}px)`, top: `${AVATAR_TOP[me.tierIndex] * 100}%` }}
        >
          <span className="mb-1 rounded-full px-2.5 py-[3px] text-[11px] font-bold text-[color:var(--eb-ink)]" style={{ background: GOLD, boxShadow: "0 2px 6px rgba(0,0,0,.35)" }}>
            あなた
          </span>
          <div className="rounded-full p-[3px]" style={{ background: `linear-gradient(135deg, rgba(255,255,255,.9), ${cssColor(me.tierIndex)})`, boxShadow: `0 0 18px ${cssColor(me.tierIndex)}` }}>
            <div className="rounded-full bg-black p-[2px]">
              <Avatar src={me.pictureUrl} name={me.displayName} size={44} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
