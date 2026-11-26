"use client";

import { useEffect, useRef, useState } from "react";
import type React from "react";
import { ChipRim } from "@/components/poker/pokerDayTheme";

/**
 * ポーカー 1試合のタイマー（表示だけ。「ゲーム終了」などの操作は PokerGameTab が持つ）。
 * - 残り時間は `startedAt` と `durationMin` から端末の時計で毎回計算する（途中から開いても合う）。
 * - 制限時間を3等分した区切りでフロップ・ターン・リバーが打ち上がり、10等分ごとにチップが POT へ飛ぶ。
 *   演出は**表示中に区切りをまたいだときだけ**。途中から開いた人には、その時点の盤面を静止で出す。
 * - 0 になったら `onTimeUp` を1回だけ呼ぶ（端末の時計が進んでいるとサーバーはまだ playing を返すので、
 *   毎秒呼ぶと GET を連打する。あとは親のポーリングに任せる）。親は試合ごとに `key={startedAt}` で作り直す。
 */

const STAGES = ["PRE-FLOP", "FLOP", "TURN", "RIVER"];
const DISC_COLORS = ["#7a1622", "#1f4fa8", "#1b1b1b"];
const TIPS = [
  "10分ごとにボードのカードが打ち上がります。30分でショーダウン。",
  "3分ごとにチップがポットへ飛んでいきます。何枚たまるかな？",
  "誰かのチップが0になったら、ディーラーが「ゲーム終了」を押します。",
  "入力するのは、30分たった時点（または誰かが0枚になった時点）のチップ数だけです。",
  "ディーラーもプレイヤーです。自分のチップ数も入力してください。",
  "その日の点数は、各試合のチップ数の合計です。",
];
const RING = 439.8; // 半径70の円周

/** 飾りのボード5枚（勝敗とは無関係）。再描画で引き直さないよう state に持つ。 */
function deal(): [string, string][] {
  const deck: [string, string][] = [];
  for (const r of "A K Q J 10 9 8 7 6 5 4 3 2".split(" ")) for (const s of ["♠", "♥", "♦", "♣"]) deck.push([r, s]);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck.slice(0, 5);
}
const sparks = () =>
  Array.from({ length: 5 }, () =>
    Array.from({ length: 10 }, () => {
      const a = Math.random() * Math.PI * 2;
      const d = 30 + Math.random() * 40;
      return { "--dx": `${Math.cos(a) * d}px`, "--dy": `${Math.sin(a) * d}px` } as React.CSSProperties;
    })
  );

const mmss = (sec: number) => {
  const s = Math.max(0, Math.ceil(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export function PokerTimer({ startedAt, durationMin, onTimeUp }: { startedAt: string | null; durationMin: number; onTimeUp: () => void }) {
  const total = durationMin * 60;
  const stepMin = Math.round(durationMin / 3);
  const tickMin = Math.round(durationMin / 10);
  const startMs = startedAt ? Date.parse(startedAt) : null;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const [tipIdx, setTipIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTipIdx((i) => i + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const elapsed = startMs == null ? 0 : Math.min(total, Math.max(0, (now - startMs) / 1000));
  const left = total - elapsed;
  const over = startMs != null && elapsed >= total;
  const stage = Math.min(3, Math.floor(elapsed / (total / 3)));
  const ticks = Math.min(10, Math.floor(elapsed / (total / 10)));

  const [cards] = useState(deal);
  const [sparkStyles] = useState(sparks);
  // 開いた時点の進み具合。これより後に増えた分だけ演出する。
  const base = useRef({ stage, ticks }).current;
  const seen = useRef({ stage, ticks });
  const [banner, setBanner] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  const stacksRef = useRef<HTMLDivElement>(null);
  const flying = useRef(new Set<HTMLElement>());

  const fired = useRef(false);
  useEffect(() => {
    if (!over || fired.current) return;
    fired.current = true;
    onTimeUp();
  }, [over, onTimeUp]);

  useEffect(() => {
    if (stage > seen.current.stage) {
      seen.current.stage = stage;
      setBanner(stage === 3 ? "SHOWDOWN" : STAGES[stage]);
    }
  }, [stage]);

  useEffect(() => {
    if (ticks <= seen.current.ticks) return;
    seen.current.ticks = ticks;
    if ((ticks * tickMin) % stepMin !== 0) setToast(`${ticks * tickMin}分経過 ・ ポットにチップ1枚`);
    // チップ型の円から POT の山へ1枚飛ばす（見本と同じ軌道）。動きを減らす設定・未対応の環境では飛ばさない。
    const chip = chipRef.current;
    const pile = stacksRef.current?.children[(ticks - 1) % 3];
    if (!chip || !pile || typeof chip.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const from = chip.getBoundingClientRect();
    const to = pile.getBoundingClientRect();
    const x0 = from.left + from.width / 2 - 17, y0 = from.top + from.height / 2 - 17;
    const x1 = to.left + to.width / 2 - 17, y1 = to.top - 40;
    const f = document.createElement("div");
    f.className = "pk-fly";
    f.style.cssText = `left:${x0}px;top:${y0}px;background:${DISC_COLORS[(ticks - 1) % 3]}`;
    document.body.appendChild(f);
    flying.current.add(f);
    f.animate(
      [
        { transform: "translate(0,0) rotate(0) scale(1)" },
        { transform: `translate(${(x1 - x0) / 2}px, ${Math.min(0, y1 - y0) - 120}px) rotate(360deg) scale(1.3)`, offset: 0.5 },
        { transform: `translate(${x1 - x0}px, ${y1 - y0}px) rotate(720deg) scale(.6)` },
      ],
      { duration: 900, easing: "cubic-bezier(.3,.7,.4,1)" }
    ).onfinish = () => { f.remove(); flying.current.delete(f); };
  }, [ticks, tickMin, stepMin]);
  useEffect(() => {
    const set = flying.current;
    return () => set.forEach((f) => f.remove());
  }, []);

  const shown = [0, 3, 4, 5][stage];
  return (
    <>
      <div ref={chipRef} className={`pk-chip${!over && left <= 60 ? " pulse" : ""}`}>
        <div key={ticks} className={ticks > base.ticks ? "pk-chip-bump" : undefined} style={{ width: "100%", height: "100%" }}>
          <svg viewBox="0 0 200 200" aria-hidden="true">
            <ChipRim />
            <circle cx="100" cy="100" r="70" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="8" />
            <circle
              cx="100" cy="100" r="70" fill="none" stroke="#e6b84a" strokeWidth="8" strokeLinecap="round"
              transform="rotate(-90 100 100)" strokeDasharray={RING} strokeDashoffset={RING * Math.min(1, elapsed / total)}
            />
          </svg>
        </div>
        <div className="pk-chip-face">
          <div>
            <div className="pk-chip-label">残り</div>
            <div className="pk-time" role="timer" aria-live="off">{startMs == null ? "--:--" : mmss(left)}</div>
            <div className="pk-stage">{over ? "SHOWDOWN" : STAGES[stage]}</div>
          </div>
        </div>
      </div>

      <div className="pk-board">
        {cards.map(([r, s], i) => {
          const revealStage = i < 3 ? 1 : i - 1;
          const animate = revealStage > base.stage;
          const delay = i < 3 ? i * 180 : 0;
          return (
            <div key={i} className="pk-slot">
              <span className="pk-tag">{Math.min(durationMin, stepMin * revealStage)}分</span>
              {i < shown && (
                <>
                  <div
                    className={`pk-card${s === "♥" || s === "♦" ? " red" : ""}${animate ? " launch" : ""}`}
                    style={animate ? { animationDelay: `${delay}ms` } : undefined}
                  >
                    <span className="r">{r}</span><span className="s">{s}</span><span className="r2">{r}</span>
                  </div>
                  {animate && sparkStyles[i].map((st, k) => (
                    <span key={k} className="pk-spark" style={{ ...st, animationDelay: `${delay + 600}ms` }} />
                  ))}
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="pk-pot">
        <div className="pk-pot-info">
          <b>POT</b>
          <span>{ticks > 0 ? `${ticks * tickMin}分経過 ・ チップ ${ticks}枚` : `${tickMin}分ごとにチップが入ります`}</span>
        </div>
        <div className="pk-stacks" ref={stacksRef}>
          {[0, 1, 2].map((col) => (
            <div key={col} className="pk-pile">
              {Array.from({ length: ticks }, (_, k) => k + 1).filter((n) => (n - 1) % 3 === col).map((n) => (
                <div key={n} className={`pk-disc${n > base.ticks ? " drop" : ""}`} style={{ background: DISC_COLORS[col] }} />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="pk-load">
        <div className="pk-load-row"><span>LOADING SHOWDOWN…</span><span>{Math.floor(Math.min(1, elapsed / total) * 100)}%</span></div>
        <div className="pk-bar">
          {[0, 1, 2].map((i) => (
            <div key={i} className="pk-seg">
              <i style={{ width: `${Math.max(0, Math.min(1, (elapsed - (i * total) / 3) / (total / 3))) * 100}%` }} />
            </div>
          ))}
        </div>
        <div className="pk-tip"><b>TIPS</b>{TIPS[tipIdx % TIPS.length]}</div>
      </div>

      {banner && <div key={banner} className="pk-banner" aria-hidden="true">{banner}</div>}
      {toast && <div key={toast} className="pk-toast" aria-hidden="true">{toast}</div>}
    </>
  );
}
