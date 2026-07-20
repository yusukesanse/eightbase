"use client";

/**
 * リーグ序列を「的（同心リング）」に写像した LEAGUE BOARD の的部分。
 * デザインハンドオフ（design_handoff_dartboard・hifi確定値）に厳密準拠。
 * ブル＝最上位ティア、外側リングほど下位。自分の位置は所属リング上のドット＋「あなた」フラッグ。
 *
 * 種目は tierPrefix で切替（"D"=ダーツ / "B"=ビリヤード / "M"=麻雀 等）。ラベルは {prefix}1/2/3。
 * 台紙（ダークカード）・見出し・凡例は親側で用意する（本コンポーネントは的SVGのみ）。
 * viewBox 0 0 224 224・中心(112,112)。色はゲーム画面専用トークン。
 */

const C = 112;
const ANGLE = (-48 * Math.PI) / 180; // 右上（README: −48°）
const COS = Math.cos(ANGLE);
const SIN = Math.sin(ANGLE);

const TIER_COLOR: Record<1 | 2 | 3, string> = { 1: "#a2125a", 2: "#1172a5", 3: "#b48f13" };
const TIER_RADIUS: Record<1 | 2 | 3, number> = { 1: 33, 2: 60, 3: 88 };

export function LeagueBoardTarget({
  tierPrefix,
  meTier,
  animate = false,
  className = "w-[240px] max-w-full h-auto",
}: {
  tierPrefix: string;
  /** 自分の所属ティア（1=最上位/ブル, 2, 3）。null で自分表示なし。 */
  meTier: 1 | 2 | 3 | null;
  animate?: boolean;
  className?: string;
}) {
  const r = meTier ? TIER_RADIUS[meTier] : null;
  const dot = r != null ? { x: C + r * COS, y: C + r * SIN } : null;
  const tip = r != null ? { x: C + (r + 26) * COS, y: C + (r + 26) * SIN } : null;
  const flag = tip ? { x: tip.x + 16, y: tip.y - 8 } : null;
  const meColor = meTier ? TIER_COLOR[meTier] : "#1172a5";

  return (
    <svg viewBox="0 0 224 224" className={className} role="img" aria-label={`${tierPrefix}リーグ ボード`}>
      {/* 外周ガイド */}
      <circle cx={C} cy={C} r={104} fill="rgba(255,255,255,.04)" stroke="rgba(255,255,255,.14)" strokeWidth={1} />
      {/* Tier3（外）→ Tier1（内） */}
      <circle cx={C} cy={C} r={88} fill="none" stroke={TIER_COLOR[3]} strokeWidth={15} strokeDasharray="24.25 3.40" opacity={0.92} transform="rotate(-85 112 112)" />
      <circle cx={C} cy={C} r={60} fill="none" stroke={TIER_COLOR[2]} strokeWidth={15} strokeDasharray="16.21 2.64" opacity={0.92} transform="rotate(-80 112 112)" />
      <circle cx={C} cy={C} r={33} fill="none" stroke={TIER_COLOR[1]} strokeWidth={14} strokeDasharray="14.86 2.42" opacity={0.95} transform="rotate(-70 112 112)" />
      {/* ブル */}
      <circle cx={C} cy={C} r={15} fill={TIER_COLOR[1]} />
      <circle cx={C} cy={C} r={15} fill="none" stroke="rgba(255,255,255,.5)" strokeWidth={1} />
      {/* ラベル */}
      <text x={C} y={116} textAnchor="middle" fill="#fff" style={{ font: "900 11px 'Noto Sans JP',sans-serif" }}>{tierPrefix}1</text>
      <text x={C} y={56} textAnchor="middle" fill="#fff" style={{ font: "800 10px 'Noto Sans JP',sans-serif" }}>{tierPrefix}2</text>
      <text x={C} y={28} textAnchor="middle" fill="#fff" style={{ font: "800 10px 'Noto Sans JP',sans-serif" }}>{tierPrefix}3</text>

      {/* 自分の位置（引き出し線＋二重ドット＋フラッグ） */}
      {dot && tip && flag && (
        <>
          <line x1={dot.x.toFixed(1)} y1={dot.y.toFixed(1)} x2={tip.x.toFixed(1)} y2={tip.y.toFixed(1)} stroke="#fff" strokeWidth={2} strokeLinecap="round" opacity={0.85} />
          {animate && <circle cx={dot.x.toFixed(1)} cy={dot.y.toFixed(1)} r={7} fill="none" stroke={meColor} strokeWidth={2} className="eb-dartpulse" />}
          <circle cx={dot.x.toFixed(1)} cy={dot.y.toFixed(1)} r={7} fill="#fff" />
          <circle cx={dot.x.toFixed(1)} cy={dot.y.toFixed(1)} r={4} fill={meColor} />
          <g transform={`translate(${flag.x.toFixed(1)}, ${flag.y.toFixed(1)})`}>
            <rect x={-26} y={-11} width={52} height={21} rx={10.5} fill="#2e2a26" />
            <text x={0} y={4} textAnchor="middle" fill="#e8ce86" style={{ font: "800 10.5px 'Noto Sans JP',sans-serif" }}>あなた</text>
          </g>
        </>
      )}
    </svg>
  );
}
