"use client";

import { Chakra_Petch } from "next/font/google";

/**
 * ポーカー当日（対戦記録タブ）だけの見た目。フェルトの緑と金、数字は Chakra Petch。
 * アプリ共通の白いグラスのトークン（--eb-*）とは別系統なので、`.pk` の中だけに閉じる。
 * 数字のフォントもここでだけ読み込む（ほかのポーカー部品から import しない）。
 */
export const pokerNum = Chakra_Petch({ weight: ["500", "700"], subsets: ["latin"], variable: "--pk-num-font", display: "swap" });

const CSS = `
.pk {
  --pk-felt: #0d3a2b; --pk-felt-deep: #06201a; --pk-panel: rgba(0,0,0,.26); --pk-line: rgba(255,255,255,.12);
  --pk-gold: #e6b84a; --pk-gold-dim: #8a6d2a; --pk-card: #fbfbf7; --pk-red: #e0505a; --pk-ink: #e9efe9; --pk-muted: #9db5a8;
  --pk-num: var(--pk-num-font), "Menlo", monospace;
  background: radial-gradient(120% 70% at 50% 20%, var(--pk-felt) 0%, var(--pk-felt-deep) 75%);
  color: var(--pk-ink); font-size: 15px; border-radius: 24px; padding: 16px 16px 24px;
  display: flex; flex-direction: column; gap: 16px;
}
.pk button { font-family: inherit; }
.pk-fade { animation: pk-fade .35s ease-out; }
@keyframes pk-fade { from { opacity: 0; transform: translateY(8px); } }
.pk-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.pk-game { font-family: var(--pk-num); font-weight: 700; letter-spacing: .12em; color: var(--pk-gold); font-size: 13px; white-space: nowrap; }
.pk-meta { font-size: 13px; color: var(--pk-muted); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pk-meta b { color: var(--pk-ink); }
.pk-hero { text-align: center; display: flex; flex-direction: column; gap: 8px; align-items: center; padding-top: 6px; }
.pk-hero h2 { margin: 0; font-size: 22px; font-weight: 900; text-wrap: balance; }
.pk-hero p { margin: 0; font-size: 14px; color: var(--pk-muted); line-height: 1.7; }
.pk-eyebrow { font-family: var(--pk-num); font-weight: 700; letter-spacing: .3em; font-size: 12px; color: var(--pk-gold); }
.pk-mini-chip { width: 120px; height: 120px; }
.pk-panel { background: var(--pk-panel); border: 1px solid var(--pk-line); border-radius: 16px; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.pk-panel h3 { margin: 0; font-size: 13px; color: var(--pk-muted); font-weight: 700; display: flex; justify-content: space-between; gap: 8px; letter-spacing: .05em; }
.pk-panel h3 span + span { font-family: var(--pk-num); color: var(--pk-ink); white-space: nowrap; }
.pk-error { background: rgba(224,80,90,.16); border: 1px solid var(--pk-red); border-radius: 12px; padding: 10px 12px; font-size: 14px; font-weight: 700; margin: 0; }

.pk-people { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.pk-person { display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 12px; border: 1px solid var(--pk-line); background: rgba(255,255,255,.03); min-width: 0; font-weight: 700; font-size: 14px; color: var(--pk-ink); text-align: left; }
.pk-person .pk-nm small { display: block; font-size: 11px; color: var(--pk-muted); font-weight: 500; white-space: normal; }
button.pk-person { border: 2px solid var(--pk-gold); background: rgba(230,184,74,.1); cursor: pointer; }
button.pk-person .pk-nm small { color: var(--pk-gold); }
button.pk-person:disabled { opacity: .55; cursor: default; }
div.pk-person { opacity: .55; }
.pk-person:focus-visible, .pk-btn:focus-visible, .pk-keys button:focus-visible, .pk-proxy:focus-visible { outline: 3px solid var(--pk-gold); outline-offset: 2px; }
.pk-av { flex: 0 0 auto; border-radius: 50%; display: grid; place-items: center; font-weight: 900; color: #1b1b1b; object-fit: cover; }
.pk-nm { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.pk-btn { width: 100%; height: 56px; border-radius: 14px; border: 0; font-weight: 700; font-size: 16px; cursor: pointer; display: grid; place-items: center; }
.pk-btn.go { background: var(--pk-gold); color: #1b1b1b; }
.pk-btn.light { background: var(--pk-card); color: #1b1b1b; }
.pk-btn.ghost { background: transparent; color: var(--pk-ink); border: 1.5px solid rgba(255,255,255,.25); }
.pk-btn:disabled { opacity: .4; cursor: default; }
.pk-note { font-size: 13px; color: var(--pk-muted); text-align: center; margin: 0; line-height: 1.6; }
.pk-stack { display: flex; flex-direction: column; gap: 10px; }

.pk-chips-in { align-items: center; gap: 6px; padding: 18px 14px; }
.pk-chips-in label { font-size: 13px; color: var(--pk-muted); }
.pk-field { display: flex; align-items: baseline; gap: 8px; border-bottom: 2px solid var(--pk-gold); padding: 0 6px 4px; }
.pk-field input { width: 7ch; background: transparent; border: 0; color: var(--pk-ink); font: 700 48px var(--pk-num); text-align: right; font-variant-numeric: tabular-nums; }
.pk-field input:focus { outline: none; }
.pk-unit { font-size: 16px; color: var(--pk-muted); font-weight: 700; }
.pk-keys { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; width: 100%; margin-top: 6px; }
.pk-keys button { height: 48px; border-radius: 12px; border: 1px solid var(--pk-line); background: rgba(255,255,255,.05); color: var(--pk-ink); font: 700 20px var(--pk-num); cursor: pointer; }
.pk-keys button:active { background: rgba(230,184,74,.25); }
.pk-done { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; color: #1b1b1b; background: var(--pk-gold); padding: 6px 12px; border-radius: 999px; }

.pk-row { display: flex; align-items: center; gap: 10px; padding: 10px 2px; border-top: 1px solid var(--pk-line); }
.pk-row:first-child { border-top: 0; }
.pk-row .pk-nm { flex: 1; font-weight: 700; font-size: 14px; }
.pk-row .pk-nm small { font-size: 11px; color: var(--pk-gold); font-weight: 700; margin-left: 4px; }
.pk-val { font-family: var(--pk-num); font-weight: 700; font-size: 18px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.pk-wait { font-size: 12px; color: var(--pk-red); font-weight: 700; white-space: nowrap; }
.pk-proxy { height: 32px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--pk-gold-dim); background: transparent; color: var(--pk-gold); font-weight: 700; font-size: 12px; cursor: pointer; white-space: nowrap; }
.pk-rank { flex: 0 0 28px; font-family: var(--pk-num); font-weight: 700; font-size: 16px; color: var(--pk-muted); text-align: center; }
.pk-row.top1 .pk-rank { color: var(--pk-gold); }
.pk-sub { display: block; font-family: var(--pk-num); font-size: 11px; color: var(--pk-muted); font-weight: 500; overflow: hidden; text-overflow: ellipsis; }
.pk-meter { height: 8px; border-radius: 4px; background: rgba(0,0,0,.35); overflow: hidden; }
.pk-meter i { display: block; height: 100%; background: linear-gradient(90deg, var(--pk-gold-dim), var(--pk-gold)); border-radius: 4px; transition: width .3s; }

.pk-podium { display: grid; grid-template-columns: 1fr 1.15fr 1fr; align-items: end; gap: 8px; }
.pk-pod { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 0; }
.pk-pod .pk-nm { font-size: 13px; font-weight: 700; max-width: 100%; }
.pk-pts { font-family: var(--pk-num); font-weight: 700; font-size: 15px; }
.pk-base { width: 100%; border-radius: 10px 10px 0 0; display: grid; place-items: start center; padding-top: 6px; font-family: var(--pk-num); font-weight: 700; color: #1b1b1b; }
.pk-pod.g .pk-base { height: 84px; background: #d8a526; }
.pk-pod.s .pk-base { height: 62px; background: #b9c0c6; }
.pk-pod.b .pk-base { height: 46px; background: #c97b3c; }

/* ── 30分タイマー ── */
.pk-chip { position: relative; width: min(72vw, 270px); aspect-ratio: 1; max-width: 100%; margin: 4px auto 0; }
.pk-chip svg { width: 100%; height: 100%; display: block; }
.pk-chip-face { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; }
.pk-chip-label { font-size: 12px; letter-spacing: .3em; color: var(--pk-muted); }
.pk-time { font-family: var(--pk-num); font-weight: 700; font-size: clamp(48px, 16vw, 64px); line-height: 1; font-variant-numeric: tabular-nums; }
.pk-stage { font-family: var(--pk-num); font-weight: 700; font-size: 13px; letter-spacing: .25em; color: var(--pk-gold); margin-top: 6px; }
.pk-chip.pulse svg { animation: pk-pulse 1s ease-in-out infinite; }
@keyframes pk-pulse { 50% { transform: scale(1.03); } }
.pk-chip-bump { animation: pk-bump .4s ease-out; }
@keyframes pk-bump { 40% { transform: scale(1.06) rotate(8deg); } }

.pk-board { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; position: relative; margin-bottom: 18px; }
.pk-slot { aspect-ratio: 5/7; border-radius: 8px; border: 1.5px dashed rgba(230,184,74,.35); position: relative; perspective: 600px; }
.pk-tag { position: absolute; bottom: -18px; left: 0; right: 0; text-align: center; font-size: 10px; color: var(--pk-muted); letter-spacing: .08em; font-family: var(--pk-num); }
.pk-card { position: absolute; inset: 0; border-radius: 8px; background: var(--pk-card); color: #1b1b1b; display: flex; flex-direction: column; justify-content: space-between; padding: 5px 6px; font-family: var(--pk-num); font-weight: 700; box-shadow: 0 6px 16px rgba(0,0,0,.45); }
.pk-card.red { color: #c8323c; }
.pk-card .r { font-size: clamp(15px, 4.6vw, 20px); line-height: 1; }
.pk-card .s { font-size: clamp(22px, 8vw, 32px); align-self: center; line-height: 1; }
.pk-card .r2 { font-size: clamp(15px, 4.6vw, 20px); line-height: 1; align-self: flex-end; transform: rotate(180deg); }
.pk-card.launch { animation: pk-launch 1.1s cubic-bezier(.2,.8,.25,1) both; }
@keyframes pk-launch {
  0%   { transform: translateY(70vh) rotate(-540deg) scale(.6); opacity: 0; }
  55%  { transform: translateY(-60px) rotate(15deg) scale(1.15); opacity: 1; }
  80%  { transform: translateY(6px) rotate(-3deg) scale(1); }
  100% { transform: none; }
}
.pk-spark { position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; border-radius: 50%; background: var(--pk-gold); pointer-events: none; opacity: 0; animation: pk-spark .8s ease-out forwards; }
@keyframes pk-spark { from { opacity: 1; } to { transform: translate(var(--dx), var(--dy)) scale(.2); opacity: 0; } }

.pk-pot { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; min-height: 64px; }
.pk-pot-info { display: flex; flex-direction: column; gap: 2px; }
.pk-pot-info b { font-family: var(--pk-num); letter-spacing: .2em; color: var(--pk-gold); font-size: 13px; }
.pk-pot-info span { font-size: 12px; color: var(--pk-muted); }
.pk-stacks { display: flex; gap: 6px; align-items: flex-end; min-height: 60px; }
.pk-pile { display: flex; flex-direction: column-reverse; min-width: 34px; }
.pk-disc { width: 34px; height: 9px; border-radius: 50%; margin-top: -3px; border: 2px dashed rgba(255,255,255,.85); box-shadow: 0 2px 0 rgba(0,0,0,.35); }
.pk-disc.drop { animation: pk-drop .35s ease-out .9s both; }
@keyframes pk-drop { from { transform: translateY(-14px); opacity: 0; } }
.pk-toast { position: fixed; left: 50%; bottom: calc(var(--bottom-nav-height, 98px) + 16px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); z-index: 70; background: rgba(0,0,0,.75); border: 1px solid var(--pk-gold-dim); color: var(--pk-ink); font-size: 13px; padding: 8px 14px; border-radius: 999px; white-space: nowrap; opacity: 0; pointer-events: none; animation: pk-toast 1.8s ease-out both; }
@keyframes pk-toast { 0% { opacity: 0; transform: translate(-50%, 10px); } 15%, 80% { opacity: 1; transform: translate(-50%, 0); } 100% { opacity: 0; } }
.pk-banner { position: fixed; left: 0; right: 0; top: 38%; text-align: center; pointer-events: none; z-index: 70; font-family: var(--pk-num); font-weight: 700; font-size: clamp(40px, 14vw, 64px); letter-spacing: .12em; color: var(--pk-gold); text-shadow: 0 0 24px rgba(230,184,74,.6); opacity: 0; animation: pk-banner 1.6s ease-out both; }
@keyframes pk-banner { 0% { opacity: 0; transform: scale(2.2); } 20% { opacity: 1; transform: scale(1); } 75% { opacity: 1; } 100% { opacity: 0; transform: scale(.9); } }

.pk-load { display: flex; flex-direction: column; gap: 8px; }
.pk-load-row { display: flex; justify-content: space-between; font-size: 12px; color: var(--pk-muted); font-family: var(--pk-num); letter-spacing: .1em; }
.pk-bar { height: 12px; border-radius: 6px; background: rgba(0,0,0,.35); overflow: hidden; display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px; padding: 2px; }
.pk-seg { border-radius: 4px; background: rgba(255,255,255,.06); position: relative; overflow: hidden; }
.pk-seg i { position: absolute; inset: 0 auto 0 0; width: 0; background: linear-gradient(90deg, var(--pk-gold-dim), var(--pk-gold)); overflow: hidden; }
.pk-seg i::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(255,255,255,.5), transparent); animation: pk-shine 1.6s linear infinite; }
@keyframes pk-shine { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
.pk-tip { min-height: 44px; font-size: 13px; line-height: 1.6; color: var(--pk-ink); background: rgba(0,0,0,.25); border-radius: 10px; padding: 10px 12px; }
.pk-tip b { color: var(--pk-gold); font-family: var(--pk-num); letter-spacing: .1em; margin-right: 6px; }

/* POT へ飛ぶチップは body 直下に置く（.pk の外）ので、色は直書き。 */
.pk-fly { position: fixed; width: 34px; height: 34px; border-radius: 50%; z-index: 70; pointer-events: none; border: 4px dashed rgba(255,255,255,.9); box-shadow: 0 6px 14px rgba(0,0,0,.5); }

/* 動きを減らす設定では演出を止める。残り時間の数字と円（stroke-dashoffset）は CSS アニメーションではないので動き続ける。 */
@media (prefers-reduced-motion: reduce) {
  .pk-fade, .pk-card.launch, .pk-chip.pulse svg, .pk-chip-bump, .pk-seg i::after, .pk-spark, .pk-disc.drop { animation: none !important; }
  .pk-banner, .pk-toast, .pk-spark { display: none; }
  .pk-meter i { transition: none; }
}
`;

/** `.pk` の中で1回だけ置く。 */
export function PokerDayStyle() {
  return <style>{CSS}</style>;
}

/** チップ型の円の外枠（タイマーと開始待ちの小さいチップで共用）。 */
export function ChipRim() {
  return (
    <>
      <circle cx="100" cy="100" r="96" fill="#7a1622" />
      <circle cx="100" cy="100" r="96" fill="none" stroke="#fbfbf7" strokeWidth="10" strokeDasharray="18 32.3" />
      <circle cx="100" cy="100" r="78" fill="#0a2a20" />
    </>
  );
}
