"use client";

/**
 * ビリヤードリーグUIの共有プリミティブ。日付ヘルパー・アイコンは麻雀/ダーツと共通（種目非依存）。
 * ボタン/アクセントは全ゲーム統一の緑（#2f7d57）。tier色は麻雀/ダーツと共通。
 */

export {
  dateParts,
  formatJpDate,
  todayJst,
  CheckIcon,
  ChevronRight,
} from "@/components/mahjong/leagueShared";

export const BILLIARDS_ACCENT = "#2f7d57";
export const BILLIARDS_CONFIRM = "#b48f13";

/** tier 色（B1/B2/B3・麻雀/ダーツと共通）。 */
export const BILLIARDS_TIER = {
  B1: { color: "#a2125a", label: "B1.LEAGUE", range: "通算 1〜4位" },
  B2: { color: "#1172a5", label: "B2.LEAGUE", range: "通算 5〜8位" },
  B3: { color: "#b48f13", label: "B3.LEAGUE", range: "通算 9位以下" },
} as const;
