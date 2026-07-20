"use client";

/* Hallmark · component: league-board · genre: playful-sport · theme: EIGHTBASE billiards tokens
 * states: default · tier B1 · tier B2 · tier B3 · unranked · animate on/off
 * palette: felt #2f7d57 / B1 #a2125a / B2 #1172a5 / B3 #b48f13 (CLAUDE.md tokens, honored)
 * contrast: pass
 */

/**
 * ビリヤードリーグ LEAGUE BOARD の盤面。ビリヤードの象徴＝8ボールの「三角ラック」を
 * フェルト卓に写像する。ラック頂点＝最上位ティア(B1)、下段ほど下位(B3)、中央は 8 ボール。
 * 自分の所属ティアの球を白リング＋「あなた」フラッグで浮かせる（的ボードと同じ操作感）。
 *
 * ダーツの的ボード（LeagueBoardTarget）とは別物・ビリヤード専用。台紙/見出し/凡例は親側。
 * 触感（フェルトの艶・木枠・レールのダイヤ標・球のハイライトと落ち影）で作り込む。
 */

const TIER_COLOR: Record<1 | 2 | 3, string> = { 1: "#a2125a", 2: "#1172a5", 3: "#b48f13" };

const CX = 120;
const TOP = 52;
const DY = 25;
const DX = 27;
const R = 12.5;

interface Ball { x: number; y: number; row: number; col: number; tier: 1 | 2 | 3; isEight: boolean }

function buildRack(): Ball[] {
  const balls: Ball[] = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col <= row; col++) {
      const x = CX + (col - row / 2) * DX;
      const y = TOP + row * DY;
      const tier: 1 | 2 | 3 = row <= 1 ? 1 : row === 2 ? 2 : 3;
      const isEight = row === 2 && col === 1; // ラック中央＝8ボール
      balls.push({ x, y, row, col, tier, isEight });
    }
  }
  return balls;
}

const RACK = buildRack();
/** そのティアで「あなた」を重ねる代表球（B1=頂点 / B2=中列左 / B3=最下段左角）。 */
const MARKER_INDEX: Record<1 | 2 | 3, number> = { 1: 0, 2: 3, 3: 10 };

/** レール照準点（ダイヤ）。長辺はサイドポケット両脇、短辺は中央寄り2点。 */
const DIAMONDS: [number, number][] = [
  [72, 23], [104, 23], [136, 23], [168, 23],
  [72, 191], [104, 191], [136, 191], [168, 191],
  [25, 84], [25, 130],
  [215, 84], [215, 130],
];

function Ball3D({ b, r = R }: { b: Ball; r?: number }) {
  const gradId = `bb-ball-${b.row}-${b.col}`;
  return (
    <g>
      {/* 落ち影 */}
      <ellipse cx={b.x + 1.5} cy={b.y + r * 0.82} rx={r * 0.9} ry={r * 0.34} fill="rgba(0,0,0,.3)" />
      {b.isEight ? (
        <>
          <circle cx={b.x} cy={b.y} r={r} fill="#15181a" />
          <circle cx={b.x} cy={b.y} r={r * 0.5} fill="#fbfbf9" />
          <text x={b.x} y={b.y + 3.4} textAnchor="middle" style={{ font: "900 10px 'Noto Sans JP',sans-serif", fill: "#15181a" }}>8</text>
        </>
      ) : (
        <>
          <defs>
            <radialGradient id={gradId} cx="38%" cy="32%" r="72%">
              <stop offset="0%" stopColor="#fff" stopOpacity={0.85} />
              <stop offset="26%" stopColor={TIER_COLOR[b.tier]} />
              <stop offset="100%" stopColor="#000" stopOpacity={0.28} />
            </radialGradient>
          </defs>
          <circle cx={b.x} cy={b.y} r={r} fill={TIER_COLOR[b.tier]} />
          <circle cx={b.x} cy={b.y} r={r} fill={`url(#${gradId})`} />
        </>
      )}
      {/* きらめき（スペキュラ） */}
      <ellipse cx={b.x - r * 0.32} cy={b.y - r * 0.4} rx={r * 0.26} ry={r * 0.17} fill="#fff" opacity={b.isEight ? 0.5 : 0.75} transform={`rotate(-32 ${b.x - r * 0.32} ${b.y - r * 0.4})`} />
      <circle cx={b.x} cy={b.y} r={r} fill="none" stroke="rgba(0,0,0,.22)" strokeWidth={0.8} />
    </g>
  );
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
  const marker = meTier ? RACK[MARKER_INDEX[meTier]] : null;
  const meColor = meTier ? TIER_COLOR[meTier] : "#1172a5";
  const tip = marker ? { x: marker.x + 21, y: marker.y - 23 } : null;
  const flag = tip ? { x: tip.x + 16, y: tip.y } : null;

  return (
    <svg viewBox="0 0 240 210" className={className} role="img" aria-label="ビリヤード リーグボード">
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
      </defs>

      {/* レール（木枠＋内側ベベル） */}
      <rect x={16} y={14} width={208} height={186} rx={22} fill="url(#bb-rail)" />
      <rect x={16} y={14} width={208} height={186} rx={22} fill="none" stroke="rgba(0,0,0,.35)" strokeWidth={1} />
      <rect x={19} y={17} width={202} height={180} rx={19} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth={1} />
      {/* レールのダイヤ照準点 */}
      {DIAMONDS.map(([dx, dy], i) => (
        <rect key={i} x={dx - 2} y={dy - 2} width={4} height={4} rx={0.6} fill="#d9c9a8" opacity={0.55} transform={`rotate(45 ${dx} ${dy})`} />
      ))}

      {/* フェルト面 */}
      <rect x={30} y={28} width={180} height={158} rx={12} fill="url(#bb-felt)" />
      <rect x={30} y={28} width={180} height={158} rx={12} fill="none" stroke="rgba(0,0,0,.28)" strokeWidth={1} />
      {/* 上部の柔らかな面光 */}
      <rect x={38} y={34} width={164} height={44} rx={22} fill="#fff" opacity={0.05} />
      {/* ポケット（6箇所・革の縁取り） */}
      {([[34, 32], [120, 30], [206, 32], [34, 182], [120, 184], [206, 182]] as [number, number][]).map(([px, py], i) => (
        <g key={i}>
          <circle cx={px} cy={py} r={8.5} fill="rgba(0,0,0,.35)" />
          <circle cx={px} cy={py} r={7} fill="#0d0a07" stroke="rgba(255,255,255,.07)" strokeWidth={1} />
        </g>
      ))}

      {/* ラック枠（木の三角） */}
      <path
        d={`M ${CX} ${TOP - R - 6} L ${CX - 2 * DX - R - 5} ${TOP + 4 * DY + 7} L ${CX + 2 * DX + R + 5} ${TOP + 4 * DY + 7} Z`}
        fill="none"
        stroke="rgba(28,17,9,.5)"
        strokeWidth={4.5}
        strokeLinejoin="round"
      />
      <path
        d={`M ${CX} ${TOP - R - 6} L ${CX - 2 * DX - R - 5} ${TOP + 4 * DY + 7} L ${CX + 2 * DX + R + 5} ${TOP + 4 * DY + 7} Z`}
        fill="none"
        stroke="rgba(214,180,120,.28)"
        strokeWidth={1}
        strokeLinejoin="round"
      />

      {/* 球（自分の球以外） */}
      {RACK.map((b, i) => (i === (marker ? MARKER_INDEX[meTier as 1 | 2 | 3] : -1) ? null : <Ball3D key={i} b={b} />))}

      {/* ティアラベル（左・帯に沿う） */}
      <text x={30} y={TOP + 4} fill={TIER_COLOR[1]} style={{ font: "900 10px 'Noto Sans JP',sans-serif" }}>B1</text>
      <text x={30} y={TOP + 2 * DY + 4} fill={TIER_COLOR[2]} style={{ font: "900 10px 'Noto Sans JP',sans-serif" }}>B2</text>
      <text x={30} y={TOP + 4 * DY + 4} fill={TIER_COLOR[3]} style={{ font: "900 10px 'Noto Sans JP',sans-serif" }}>B3</text>

      {/* 自分の位置（浮遊する球＋白リング＋引き出し線＋フラッグ） */}
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
