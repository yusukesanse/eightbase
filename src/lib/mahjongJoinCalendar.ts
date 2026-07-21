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

/** 終了した開催日（今日 JST より前の土曜）か。today は "YYYY-MM-DD"（JST）。※旧・土曜前提。 */
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
  /** 管理者が登録した開催日（mahjongSchedule）。1件でもあればスケジュール駆動（曜日不問）。 */
  scheduledDates?: Set<string>;
}

/**
 * その日が「開催日」か（サーバーの resolveMahjongEventDate と同じ判定）。
 * - スケジュール駆動（scheduledDates が非空）: その集合に含まれる日のみ（曜日不問＝日曜も可・休催は無視）。
 * - 未移行（scheduledDates が空/未指定）: 毎週土曜 かつ 休催でない（従来どおり）。
 */
export function isMahjongEventDay(dateStr: string, ctx: JoinCalendarCtx): boolean {
  const scheduled = ctx.scheduledDates;
  if (scheduled && scheduled.size > 0) return scheduled.has(dateStr);
  return isSaturdayDate(dateStr) && !ctx.closedDates.has(dateStr);
}

/**
 * カレンダーでタップ可か（＝参加者一覧・当日順位を閲覧できる）。
 * 参加日は常に可。それ以外は「開催日」かつ「中止でない」なら過去・未来を問わず閲覧可。
 */
export function isViewableDate(dateStr: string, ctx: JoinCalendarCtx): boolean {
  if (ctx.enteredDates.has(dateStr)) return true;
  if (!isMahjongEventDay(dateStr, ctx)) return false;
  if (ctx.cancelledDates.has(dateStr)) return false;
  return true;
}

/** 終了した開催日か（開催日 かつ 今日より前）。スケジュール駆動なら日曜等の過去開催も判定できる。 */
export function isPastEventDate(dateStr: string, ctx: JoinCalendarCtx): boolean {
  return isMahjongEventDay(dateStr, ctx) && dateStr < ctx.today;
}

export interface JoinabilityCtx extends JoinCalendarCtx {
  /** 満員（定員8名・抜け番許容OFF）。選択日について判定した値を渡す。 */
  full: boolean;
}

/**
 * 「参加する」ボタンを出せるか。
 * 未来（または当日）の開催日・中止でない・未参加・満員でない・当月別日参加なし。
 * 過去日は参加不可（閲覧専用）。
 */
export function canJoinDate(dateStr: string, ctx: JoinabilityCtx): boolean {
  if (!isMahjongEventDay(dateStr, ctx)) return false;
  if (dateStr < ctx.today) return false; // 過去は参加不可
  if (ctx.cancelledDates.has(dateStr)) return false;
  if (ctx.enteredDates.has(dateStr)) return false;
  if (ctx.full) return false;
  if (isMonthlyBlocked(dateStr, ctx.enteredDates)) return false;
  return true;
}
