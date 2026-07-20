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

// ダーツのアクセント（ダーツボード・レッド系。麻雀の緑と区別する）
export const DARTS_ACCENT = "#c0392b";
// 確定・支払いの色（CSメダル金系。参加中の赤と区別する・麻雀と共通）
export const DARTS_CONFIRM = "#b48f13";
