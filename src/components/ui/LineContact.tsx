"use client";

/**
 * メンバー一覧・掲示板で共用する「LINEで連絡」フローの部品群。
 * - LINE送信は現時点ではUIのみ（スタブ）。実送信は将来 LIFF/Messaging API に接続する。
 * - LINEロゴ / SNSグリフはプロトタイプのインラインSVG。本番は公式アセットに差し替えること。
 */

export const LINE_GREEN = "#06C755";

type AvatarSize = "sm" | "md" | "lg" | "xl" | number;
const AVATAR_PX: Record<string, number> = { sm: 36, md: 44, lg: 56, xl: 72 };

export function Avatar({
  src,
  name,
  size = "md",
  className = "",
  style,
}: {
  src?: string | null;
  name?: string;
  size?: AvatarSize;
  className?: string;
  style?: React.CSSProperties;
}) {
  const px = typeof size === "number" ? size : AVATAR_PX[size] ?? 44;
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name || ""}
        className={`rounded-full object-cover shrink-0 ${className}`}
        style={{ width: px, height: px, ...style }}
      />
    );
  }
  return (
    <div
      className={`rounded-full bg-[#dde9eb] flex items-center justify-center shrink-0 ${className}`}
      style={{ width: px, height: px, ...style }}
    >
      <svg width={px * 0.5} height={px * 0.5} viewBox="0 0 24 24" fill="none" stroke="#7fa0a6" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
      </svg>
    </div>
  );
}

/** LINEロゴ（角丸緑の四角＋白い吹き出し＋緑の "LINE"）。緑ボタン上では白い吹き出しのみ見える。 */
export function LineGlyph({ size = 20, color = LINE_GREEN }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ display: "block" }}>
      <rect width="24" height="24" rx="6" fill={color} />
      <path d="M12 4.6c-4.2 0-7.6 2.7-7.6 6.1 0 3 2.7 5.5 6.3 6 .25.05.59.16.67.38.07.2.05.5.02.7 0 0-.09.55-.11.66-.03.2-.16.77.68.42 3.04-1.79 4.1-2.96 5.36-4.43.86-.99 1.31-2 1.31-3.73 0-3.4-3.4-6.1-7.6-6.1z" fill="#fff" />
      <text x="12" y="13.4" textAnchor="middle" fill={color} fontSize="4.4" fontWeight="700" fontFamily="Arial, sans-serif" letterSpacing="0.2">LINE</text>
    </svg>
  );
}

/* ── 単色ラインSVG（currentColor） ── */
export function GlobeIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" />
    </svg>
  );
}
export function XGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4l16 16M20 4L4 20" />
    </svg>
  );
}
export function InstagramGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}
export function FacebookGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 8.5h2M14.5 8.5c0-2 1-3 3-3M14.5 8.5V20M14.5 12.5h-3M14.5 12.5h2.5" />
    </svg>
  );
}

/* ── シート用ボタン ── */
export function SheetButton({
  children,
  onClick,
  disabled,
  variant = "primary",
  line,
  fullWidth,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  line?: boolean;
  fullWidth?: boolean;
}) {
  const base =
    "h-11 rounded-xl text-[14px] font-bold flex items-center justify-center gap-1.5 transition-transform active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100";
  const width = fullWidth ? "w-full" : "flex-1";
  const tone = line
    ? "text-white"
    : variant === "secondary"
      ? "bg-white border border-[#e4e7e9] text-[#40434a]"
      : "bg-[#4f757e] text-white";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${width} ${tone}`}
      style={line ? { background: LINE_GREEN } : undefined}
    >
      {line && <LineGlyph size={18} />}
      {children}
    </button>
  );
}
