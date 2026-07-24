"use client";

/**
 * ポーカーリーグUIの共有プリミティブ（定数・日付ヘルパー・アイコン）。
 * 日付ヘルパー・アイコンは麻雀の leagueShared と同一（種目非依存）なので再利用する。
 */

export {
  dateParts,
  formatJpDate,
  todayJst,
  CheckIcon,
  ChevronRight,
} from "@/components/mahjong/leagueShared";

// ボタン/アクセントは**全ゲーム統一**（麻雀リーグと同じ緑）。種目でボタン色を変えると
// 利用者が混乱するため、意図的に共通化している。
export const POKER_ACCENT = "#2f7d57";
// 確定・支払いの色（麻雀 leagueShared.CONFIRM と共通）。
export const POKER_CONFIRM = "#b48f13";

// tier色は麻雀 M1/M2/M3 と同じリーグDS色（globals.css の --eb-league-m1/m2/m3）。
export const POKER_TIER_COLOR = { P1: "#a2125a", P2: "#1172a5", P3: "#b48f13" } as const;

/** チップ数を桁区切りで表示。 */
export const fmtChips = (n: number): string => n.toLocaleString();
