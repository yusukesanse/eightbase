import { readCalendarDay, type CalendarReadErrorKind } from "@/lib/calendarBusy";
import { todayJst } from "@/lib/date";
import { CALENDAR_CHECK_ERRORS } from "@/lib/calendarCheckMessages";

const CALENDAR_CHECK_TIMEOUT_MS = 5000;

/**
 * calendarId を body に含む保存のとき、毎回チェックする。保存は成功として扱い、
 * 読み取り不可・タイムアウトだけを警告として返す（errorKind ごとに文言を分ける）。
 * timeoutMs はテスト用に差し替え可能（既定 5000ms）。
 */
export async function calendarWarningAfterSave(
  calendarId: unknown,
  timeoutMs: number = CALENDAR_CHECK_TIMEOUT_MS
): Promise<{ message: string; kind: CalendarReadErrorKind | "timeout" } | undefined> {
  if (typeof calendarId !== "string" || !calendarId) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ ok: false; errorKind: "timeout" }>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, errorKind: "timeout" }), timeoutMs);
  });
  try {
    const result = await Promise.race([readCalendarDay(calendarId, todayJst()), timeout]);
    if (result.ok) return undefined;
    return { kind: result.errorKind, message: CALENDAR_CHECK_ERRORS[result.errorKind] };
  } catch {
    return { kind: "other", message: CALENDAR_CHECK_ERRORS.other };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
