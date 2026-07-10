/**
 * 曜日判定のタイムゾーン退行を防ぐテスト。
 *
 * 本番(Vercel)は TZ=UTC で動くため、`new Date("YYYY-MM-DDT00:00:00+09:00").getDay()` は
 * 前日の曜日を返す（土曜→金曜）。土曜のみ営業のサウナが本番でのみ予約できなくなった実障害の再発防止。
 *
 * ⚠️ この検証は TZ=UTC でのみ意味を持つ（JST では壊れた実装でも通ってしまう）。
 * TZ は Node 起動時に決まり `process.env.TZ` の代入では変えられないため、
 * package.json の test スクリプトで `TZ=UTC` を渡している。素の `npx jest` では実行しないこと。
 */
import { dayOfWeek } from "@/lib/date";
import { validateReservationSlot } from "@/lib/reservations";
import type { Facility } from "@/types";

// PAST_DATE チェック（実時刻依存）に引っかからないよう、十分先の日付を使う。
const FRIDAY = "2099-01-02";
const SATURDAY = "2099-01-03";
const SUNDAY = "2099-01-04";

// 土曜のみ営業のサウナ（availableDays: 6=土）
const sauna = {
  facilityId: "sauna",
  name: "サウナ",
  openTime: "09:00",
  closeTime: "18:00",
  availableDays: [6],
} as unknown as Facility;

const slot = { startTime: "10:00", endTime: "11:00" };

describe("dayOfWeek はサーバーのTZに依存しない", () => {
  it("UTC環境でも土曜を 6 と判定する", () => {
    expect(dayOfWeek(SATURDAY)).toBe(6);
    expect(dayOfWeek(FRIDAY)).toBe(5);
  });
});

describe("validateReservationSlot の利用可能曜日（UTC環境）", () => {
  it("土曜のみ営業の施設は、土曜の予約を通す", () => {
    expect(validateReservationSlot(sauna, { date: SATURDAY, ...slot })).toEqual({ ok: true });
  });

  it("土曜のみ営業の施設は、金曜の予約を曜日で弾く", () => {
    const r = validateReservationSlot(sauna, { date: FRIDAY, ...slot });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("OUT_OF_HOURS");
  });

  it("既定（平日）の施設は、月〜金を通し土日を弾く", () => {
    const weekday = { ...sauna, availableDays: undefined } as unknown as Facility;
    expect(validateReservationSlot(weekday, { date: FRIDAY, ...slot }).ok).toBe(true);
    expect(validateReservationSlot(weekday, { date: SATURDAY, ...slot }).ok).toBe(false);
    expect(validateReservationSlot(weekday, { date: SUNDAY, ...slot }).ok).toBe(false);
  });
});
