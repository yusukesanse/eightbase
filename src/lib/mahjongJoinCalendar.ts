/**
 * 麻雀リーグ参加タブのカレンダー判定（純関数・DOM/React 非依存でテスト可能）。
 *
 * 「閲覧可（カレンダーでタップ可）」と「参加可（『参加する』ボタン）」を分離する。
 * - isViewableDate: 参加者一覧・当日順位を見るために選べる日。満員・当月別日参加済み・
 *   **終了した過去の土曜**も閲覧できる（成績確認用）。
 * - canJoinDate: 実際に参加確定できる日。過去日は不可（閲覧専用）。
 *
 * 日付は "YYYY-MM-DD"。曜日は UTC 正午基準で判定し TZ の影響を避ける（本番 UTC 対策）。
 */

/** UTC 正午基準で土曜か（TZ 非依存）。 */
export function isSaturdayDate(dateStr: string): boolean {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay() === 6;
}

/** 終了した開催日（今日 JST より前の土曜）か。today は "YYYY-MM-DD"（JST）。 */
export function isPastSaturday(dateStr: string, today: string): boolean {
  return isSaturdayDate(dateStr) && dateStr < today;
}

/** 当月に別日で参加確定済みか（月1回制限）。当日自身は除外する。 */
export function isMonthlyBlocked(dateStr: string, enteredDates: Set<string>): boolean {
  const ym = dateStr.slice(0, 7);
  return Array.from(enteredDates).some((e) => e !== dateStr && e.slice(0, 7) === ym);
}

export interface JoinCalendarCtx {
  /** 今日（JST）"YYYY-MM-DD" */
  today: string;
  /** 参加確定済みの開催日（楽観差分込みの実効集合） */
  enteredDates: Set<string>;
  /** 休催日 */
  closedDates: Set<string>;
  /** 中止（流会）の日 */
  cancelledDates: Set<string>;
}

/**
 * カレンダーでタップ可か（＝参加者一覧・当日順位を閲覧できる）。
 * 参加日は曜日/過去に関わらず常に可。それ以外は「土曜」かつ「休催・中止でない」なら
 * 過去・未来を問わず閲覧可。土曜以外・休催・中止は不可。
 */
export function isViewableDate(dateStr: string, ctx: JoinCalendarCtx): boolean {
  if (ctx.enteredDates.has(dateStr)) return true;
  if (!isSaturdayDate(dateStr)) return false;
  if (ctx.closedDates.has(dateStr)) return false;
  if (ctx.cancelledDates.has(dateStr)) return false;
  return true;
}

export interface JoinabilityCtx extends JoinCalendarCtx {
  /** 満員（定員8名・抜け番許容OFF）。選択日について判定した値を渡す。 */
  full: boolean;
}

/**
 * 「参加する」ボタンを出せるか。
 * 未来（または当日）の土曜・休催/中止でない・未参加・満員でない・当月別日参加なし。
 * 過去日は参加不可（閲覧専用）。
 */
export function canJoinDate(dateStr: string, ctx: JoinabilityCtx): boolean {
  if (!isSaturdayDate(dateStr)) return false;
  if (dateStr < ctx.today) return false; // 過去は参加不可
  if (ctx.closedDates.has(dateStr)) return false;
  if (ctx.cancelledDates.has(dateStr)) return false;
  if (ctx.enteredDates.has(dateStr)) return false;
  if (ctx.full) return false;
  if (isMonthlyBlocked(dateStr, ctx.enteredDates)) return false;
  return true;
}
