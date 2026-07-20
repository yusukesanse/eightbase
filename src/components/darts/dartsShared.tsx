"use client";

/**
 * ダーツリーグUIの共有プリミティブ（定数・日付ヘルパー・アイコン）。
 * DartsLeagueView / DartsJoinTab / DartsReportTab / DartsGmPanel から共用する。
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
// 利用者が混乱するため、意図的に共通化している（麻雀 leagueShared.ACCENT と同値）。
export const DARTS_ACCENT = "#2f7d57";
// 確定・支払いの色（CSメダル金系・麻雀 leagueShared.CONFIRM と共通）。
export const DARTS_CONFIRM = "#b48f13";
