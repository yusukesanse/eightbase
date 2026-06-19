/**
 * 予約スロットの共通バリデーション / 重なり判定ヘルパー。
 *
 * 目的:
 *   - 空き状況API(availability) と 予約確定API(POST /api/reservations) で
 *     「同じルール」を使い、表示と確定の判定がズレないようにする。
 *   - 時間帯の重なり(overlap)判定を一箇所に集約する。
 *
 * 重なり防止の最終判断は、予約APIが Firestore transaction 内で
 * reservationLocks を facilityId+date 単位に読み、ここの intervalsOverlap で
 * 判定して行う（Google Calendar の checkAvailability は補助）。
 */

import type { Facility } from "@/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/** "HH:MM" → 0時からの分。 */
export function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/**
 * 半開区間 [aStart, aEnd) と [bStart, bEnd) が重なるか（分単位）。
 * 隣接（前の終了 == 次の開始）は重ならない扱い。
 */
export function intervalsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export type SlotValidationReason =
  | "INVALID_RANGE"
  | "PAST_DATE"
  | "OUT_OF_HOURS"
  | "DURATION_INVALID"
  | "TERMS_REQUIRED";

export interface SlotValidationResult {
  ok: boolean;
  reason?: SlotValidationReason;
  message?: string;
}

/**
 * 施設の設定（営業時間・利用可能曜日・最低/固定利用時間・利用規約）に対して
 * 予約スロット(date/startTime/endTime)が妥当かを検証する。
 *
 * - 重なり(overlap)は対象外（別途 transaction 内で判定する）。
 * - enforceTerms=true のときのみ requireTerms→termsAgreed を必須にする
 *   （空き状況の確認時は規約同意を問わないため既定 false）。
 */
export function validateReservationSlot(
  facility: Facility,
  params: {
    date: string;
    startTime: string;
    endTime: string;
    termsAgreed?: boolean;
    enforceTerms?: boolean;
  }
): SlotValidationResult {
  const { date, startTime, endTime, termsAgreed, enforceTerms = false } = params;

  if (!DATE_RE.test(date) || !TIME_RE.test(startTime) || !TIME_RE.test(endTime)) {
    return { ok: false, reason: "INVALID_RANGE", message: "日付・時刻の形式が不正です。" };
  }

  const open = timeToMin(facility.openTime ?? "09:00");
  const close = timeToMin(facility.closeTime ?? "18:00");
  const start = timeToMin(startTime);
  const end = timeToMin(endTime);
  const availableDays = facility.availableDays ?? [1, 2, 3, 4, 5];

  // 過去日チェック（Asia/Tokyo 基準）
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(
    new Date()
  );
  if (date < today) {
    return { ok: false, reason: "PAST_DATE", message: "過去の日付は予約できません。" };
  }

  // 利用可能曜日チェック
  const dayOfWeek = new Date(date + "T00:00:00+09:00").getDay();
  if (!availableDays.includes(dayOfWeek)) {
    return { ok: false, reason: "OUT_OF_HOURS", message: "この曜日は利用できません。" };
  }

  // 範囲の妥当性
  if (end <= start) {
    return {
      ok: false,
      reason: "INVALID_RANGE",
      message: "終了時刻は開始時刻より後にしてください。",
    };
  }
  if (start < open || end > close) {
    return { ok: false, reason: "OUT_OF_HOURS", message: "利用時間外です。" };
  }

  // 時間枠（固定枠 / 最低利用時間）。prepTime は minDuration に含まれる前提。
  const duration = end - start;
  if (facility.fixedDuration) {
    const fixed = facility.minDuration ?? 0;
    if (fixed > 0 && duration !== fixed) {
      return {
        ok: false,
        reason: "DURATION_INVALID",
        message: `この施設は${fixed}分の固定枠です。`,
      };
    }
  } else if (facility.minDuration && duration < facility.minDuration) {
    return {
      ok: false,
      reason: "DURATION_INVALID",
      message: `最低利用時間は${facility.minDuration}分です。`,
    };
  }

  // 利用規約（予約確定時のみ）
  if (enforceTerms && facility.requireTerms && termsAgreed !== true) {
    return {
      ok: false,
      reason: "TERMS_REQUIRED",
      message: "利用規約への同意が必要です。",
    };
  }

  return { ok: true };
}
