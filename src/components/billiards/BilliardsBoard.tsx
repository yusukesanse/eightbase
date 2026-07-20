"use client";

/* Hallmark · component: league-board · genre: playful-sport · theme: EIGHTBASE billiards tokens
 * composition: break-shot v2 — radial expansion from break point (distance encodes tier)
 * states: default · tier B1 · tier B2 · tier B3 · unranked · animate on/off
 * palette: felt #2f7d57 / B1 #a2125a / B2 #1172a5 / B3 #b48f13 (CLAUDE.md tokens, honored)
 * pre-emit critique: P4 H5 E5 S5 R5 V5
 */

/**
 * ビリヤードリーグ LEAGUE BOARD の盤面（ブレイク構図 v2）。
 * 左からキューがキューボールを撞き、破裂点から球が放射状に広がる。
 * 距離＝ティア（内=B1 / 中=B2 / 外=B3）＋色でティアを二重に表現。中央前縁に 8 ボール。
 * 自分の所属ティアの球を浮かせ、白リング＋「あなた」（フラッグは左右自動で見切れ防止）。
 *
 * 触感（フェルトの艶・木レール・照準ダイヤ・球のハイライトと落ち影・放射トレイル・インパクト光）
 * で作り込む。モーション言語は「放射トレイル」1本に統一。ダーツ側とは無関係・ビリヤード専用。
 */

const TIER_COLOR: Record<1 | 2 | 3, string> = { 1: "#a2125a", 2: "#1172a5", 3: "#b48f13" };
const R = 11;
const BP_X = 100; // 破裂点（放射・トレイルの中心）
const BP_Y = 106;

interface Ball { key: string; x: number; y: number; tier?: 1 | 2 | 3; eight?: boolean; trail?: boolean }

/** 破裂点からの放射配置（距離＝ティア）。B1 内周×4 / B2 中周×4 / B3 外周×2 ＋ 8ボール。 */
function polar(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [BP_X + r * Math.cos(a), BP_Y - r * Math.sin(a)];
}
function mk(key: string, r: number, deg: number, tier: 1 | 2 | 3): Ball {
  const [x, y] = polar(r, deg);
  return { key, x: +x.toFixed(1), y: +y.toFixed(1), tier, trail: true };
}
const BALLS: Ball[] = [
  mk("b1a", 32, 40, 1), mk("b1b", 32, 14, 1), mk("b1c", 32, -14, 1), mk("b1d", 32, -40, 1),
  { key: "eight", x: 111, y: 105, eight: true },
  mk("b2a", 54, 44, 2), mk("b2b", 54, 14, 2), mk("b2c", 54, -16, 2), mk("b2d", 54, -46, 2),
  mk("b3a", 78, 28, 3), mk("b3b", 78, -26, 3),
];
/** そのティアで「あなた」を重ねる代表球。 */
const MARKER_KEY: Record<1 | 2 | 3, string> = { 1: "b1a", 2: "b2b", 3: "b3a" };

const DIAMONDS: [number, number][] = [
  [72, 23], [104, 23], [136, 23], [168, 23],
  [72, 191], [104, 191], [136, 191], [168, 191],
  [25, 84], [25, 130], [215, 84], [215, 130],
];

function Ball3D({ b, r = R }: { b: Ball; r?: number }) {
  const gradId = `bb-${b.key}`;
  if (b.eight) {
    return (
      <g>
        <ellipse cx={b.x + 1.5} cy={b.y + r * 0.82} rx={r * 0.9} ry={r * 0.34} fill="rgba(0,0,0,.3)" />
        <circle cx={b.x} cy={b.y} r={r} fill="#15181a" />
        <circle cx={b.x} cy={b.y} r={r * 0.5} fill="#fbfbf9" />
        <text x={b.x} y={b.y + 3.4} textAnchor="middle" style={{ font: "900 9px 'Noto Sans JP',sans-serif", fill: "#15181a" }}>8</text>
        <ellipse cx={b.x - r * 0.32} cy={b.y - r * 0.4} rx={r * 0.24} ry={r * 0.15} fill="#fff" opacity={0.5} transform={`rotate(-32 ${b.x - r * 0.32} ${b.y - r * 0.4})`} />
      </g>
    );
  }
  const color = b.tier ? TIER_COLOR[b.tier] : "#e9e9e2"; // tier なし＝キューボール
  return (
    <g>
      <ellipse cx={b.x + 1.5} cy={b.y + r * 0.82} rx={r * 0.9} ry={r * 0.34} fill="rgba(0,0,0,.3)" />
      <defs>
        <radialGradient id={gradId} cx="38%" cy="32%" r="72%">
          <stop offset="0%" stopColor="#fff" stopOpacity={b.tier ? 0.85 : 1} />
          <stop offset="26%" stopColor={color} />
          <stop offset="100%" stopColor="#000" stopOpacity={b.tier ? 0.28 : 0.14} />
        </radialGradient>
      </defs>
      <circle cx={b.x} cy={b.y} r={r} fill={color} />
      <circle cx={b.x} cy={b.y} r={r} fill={`url(#${gradId})`} />
      <ellipse cx={b.x - r * 0.32} cy={b.y - r * 0.4} rx={r * 0.26} ry={r * 0.17} fill="#fff" opacity={0.75} transform={`rotate(-32 ${b.x - r * 0.32} ${b.y - r * 0.4})`} />
      <circle cx={b.x} cy={b.y} r={r} fill="none" stroke="rgba(0,0,0,.2)" strokeWidth={0.8} />
    </g>
  );
}

/** 放射トレイル（破裂点に向かう淡い尾）。 */
function Trail({ b }: { b: Ball }) {
  const dx = BP_X - b.x, dy = BP_Y - b.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const x1 = b.x + ux * (R + 1), y1 = b.y + uy * (R + 1);
  const x2 = b.x + ux * (R + 12), y2 = b.y + uy * (R + 12);
  return <line x1={x1.toFixed(1)} y1={y1.toFixed(1)} x2={x2.toFixed(1)} y2={y2.toFixed(1)} stroke="#fff" strokeWidth={2.4} strokeLinecap="round" opacity={0.17} />;
}

export function BilliardsBoard({
  meTier,
  animate = false,
  className = "w-[240px] max-w-full h-auto",
}: {
  meTier: 1 | 2 | 3 | null;
  animate?: boolean;
  className?: string;
}) {
  const markerKey = meTier ? MARKER_KEY[meTier] : null;
  const marker = markerKey ? BALLS.find((b) => b.key === markerKey)! : null;
  const meColor = meTier ? TIER_COLOR[meTier] : "#1172a5";
  const cue: Ball = { key: "cue", x: 74, y: 110 };

  // フラッグは右端で見切れないよう左右自動。
  const flagLeft = marker ? marker.x > 135 : false;
  const dir = flagLeft ? -1 : 1;
  const tip = marker ? { x: marker.x + 21 * dir, y: marker.y - 23 } : null;
  const flag = tip ? { x: tip.x + 16 * dir, y: tip.y } : null;

  return (
    <svg viewBox="0 0 240 210" className={className} role="img" aria-label="ビリヤード リーグボード（ブレイク）">
      <defs>
        <radialGradient id="bb-felt" cx="50%" cy="34%" r="80%">
          <stop offset="0%" stopColor="#369066" />
          <stop offset="62%" stopColor="#2a7351" />
          <stop offset="100%" stopColor="#154931" />
        </radialGradient>
        <linearGradient id="bb-rail" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5a3a24" />
          <stop offset="100%" stopColor="#3a2415" />
        </linearGradient>
        <linearGradient id="bb-cue" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#6b4a2e" />
          <stop offset="70%" stopColor="#b98a52" />
          <stop offset="100%" stopColor="#d8b47a" />
        </linearGradient>
        <radialGradient id="bb-impact" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff" stopOpacity={0.5} />
          <stop offset="100%" stopColor="#fff" stopOpacity={0} />
        </radialGradient>
      </defs>

      {/* レール（木枠＋内側ベベル＋照準ダイヤ） */}
      <rect x={16} y={14} width={208} height={186} rx={22} fill="url(#bb-rail)" />
      <rect x={16} y={14} width={208} height={186} rx={22} fill="none" stroke="rgba(0,0,0,.35)" strokeWidth={1} />
      <rect x={19} y={17} width={202} height={180} rx={19} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth={1} />
      {DIAMONDS.map(([dx, dy], i) => (
        <rect key={i} x={dx - 2} y={dy - 2} width={4} height={4} rx={0.6} fill="#d9c9a8" opacity={0.55} transform={`rotate(45 ${dx} ${dy})`} />
      ))}

      {/* フェルト面 */}
      <rect x={30} y={28} width={180} height={158} rx={12} fill="url(#bb-felt)" />
      <rect x={30} y={28} width={180} height={158} rx={12} fill="none" stroke="rgba(0,0,0,.28)" strokeWidth={1} />
      <rect x={38} y={34} width={164} height={44} rx={22} fill="#fff" opacity={0.05} />
      {([[34, 32], [120, 30], [206, 32], [34, 182], [120, 184], [206, 182]] as [number, number][]).map(([px, py], i) => (
        <g key={i}>
          <circle cx={px} cy={py} r={8.5} fill="rgba(0,0,0,.35)" />
          <circle cx={px} cy={py} r={7} fill="#0d0a07" stroke="rgba(255,255,255,.07)" strokeWidth={1} />
        </g>
      ))}

      {/* インパクト光（破裂点） */}
      <circle cx={BP_X + 6} cy={BP_Y} r={20} fill="url(#bb-impact)" />
      {/* 放射トレイル */}
      {BALLS.filter((b) => b.trail).map((b) => <Trail key={`t-${b.key}`} b={b} />)}

      {/* キュースティック＋キューボール（撞く瞬間・残像） */}
      <line x1={cue.x - R - 2} y1={cue.y + 1} x2={cue.x - R - 12} y2={cue.y + 2} stroke="#fff" strokeWidth={2.6} strokeLinecap="round" opacity={0.2} />
      <line x1={13} y1={185} x2={cue.x - R - 1} y2={cue.y + 1} stroke="url(#bb-cue)" strokeWidth={4.4} strokeLinecap="round" />
      <line x1={34} y1={150} x2={cue.x - R - 1} y2={cue.y + 1} stroke="#e7c58a" strokeWidth={2} strokeLinecap="round" opacity={0.5} />
      <circle cx={cue.x - R - 1} cy={cue.y + 1} r={2.2} fill="#2f6fb0" />
      <Ball3D b={cue} />

      {/* ラックの球（自分の球以外・8ボール含む） */}
      {BALLS.map((b) => (b.key === markerKey ? null : <Ball3D key={b.key} b={b} />))}

      {/* 自分の位置（浮遊する球＋白リング＋引き出し線＋フラッグ／左右自動） */}
      {marker && tip && flag && (
        <>
          <line x1={marker.x} y1={marker.y - R} x2={tip.x.toFixed(1)} y2={(tip.y + 8).toFixed(1)} stroke="#fff" strokeWidth={2} strokeLinecap="round" opacity={0.85} />
          {animate && <circle cx={marker.x} cy={marker.y} r={R + 4} fill="none" stroke="#fff" strokeWidth={2} className="eb-dartpulse" />}
          <g className={animate ? "eb-dartfloat" : undefined}>
            <Ball3D b={marker} r={R + 1} />
            <circle cx={marker.x} cy={marker.y} r={R + 3.5} fill="none" stroke="#fff" strokeWidth={2.5} />
            <circle cx={marker.x} cy={marker.y} r={R + 3.5} fill="none" stroke={meColor} strokeWidth={1} />
          </g>
          <g transform={`translate(${flag.x.toFixed(1)}, ${flag.y.toFixed(1)})`}>
            <rect x={-26} y={-11} width={52} height={21} rx={10.5} fill="#2e2a26" />
            <text x={0} y={4} textAnchor="middle" fill="#e8ce86" style={{ font: "800 10.5px 'Noto Sans JP',sans-serif" }}>あなた</text>
          </g>
        </>
      )}
    </svg>
  );
}
