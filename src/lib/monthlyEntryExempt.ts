/**
 * 「参加は同じ月に1回まで」の制限を、管理者が特定ユーザーだけ解除する仕組み。
 *
 * - 保存先は `authorizedUsers.monthlyEntryExempt`（boolean）。**4種目共通の1フラグ**で、
 *   麻雀・ダーツ・ビリヤード・ポーカーすべての月1回制限が外れる。
 * - 判定は必ずサーバー（各種目の `POST /api/{game}/entries`）で行う。クライアントの表示は
 *   `GET /api/{game}/entries?mine=1` が返す `monthlyExempt` を使うが、それは UI の出し分けだけ。
 * - 免除でも**月ロックdoc（`{game}MonthlyLocks`）は今までどおり書く**。ロックは「最後に参加した日」を
 *   指すだけになるが、制限の判定は「ロックが指す別日の entry が実在するか」で行うため、
 *   免除を後から外しても壊れない（実在しないロックは自己回復する）。
 * - 免除の対象は月1回制限だけ。**定員・受付締切・参加費は免除しない**。
 */

/** authorizedUsers に保存するフィールド名（管理APIと共有し、綴りのブレを防ぐ）。 */
export const MONTHLY_ENTRY_EXEMPT_FIELD = "monthlyEntryExempt";

/**
 * 月1回制限が免除されたユーザーか。
 * 未設定・旧レコードは false（＝従来どおり月1回）。仮ユーザー（プレビュー/バイパス）も false。
 */
export function isMonthlyEntryExempt(
  user: { monthlyEntryExempt?: unknown } | null | undefined
): boolean {
  return user?.monthlyEntryExempt === true;
}
