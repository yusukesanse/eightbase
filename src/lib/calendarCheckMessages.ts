import type { CalendarReadErrorKind } from "@/lib/calendarBusy";

/** カレンダー接続チェック・保存後警告で共用するエラー文言。errorKind ごとに理由が分かる文にする。 */
export type CalendarCheckMessageKind = CalendarReadErrorKind | "not_configured" | "timeout";

export const CALENDAR_CHECK_ERRORS: Record<CalendarCheckMessageKind, string> = {
  not_configured: "この施設にはカレンダーIDが設定されていません",
  not_found: "カレンダーが見つからないか、アプリ用アカウントに共有されていません（カレンダーIDと共有設定の両方を確認してください）",
  forbidden: "アクセスが拒否されました（アプリ用アカウントの権限や Google Calendar API の設定を確認してください）",
  timeout: "Google カレンダーの応答がありませんでした（時間をおいて接続チェックで再確認してください）",
  other: "読み取りに失敗しました（時間をおいて再度お試しください）",
};
