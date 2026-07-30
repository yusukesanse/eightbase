/**
 * 直前予約の禁止（`Facility.minAdvanceDays`＝利用日の何日前までに予約が必要か）。
 *
 * 「1週間前まで」= minAdvanceDays 7 のとき、**ちょうど7日後は予約できる / 6日後は不可**。
 * この境界を固定する。
 *
 * ⚠️ 本番は TZ=UTC。日付の加算に `new Date(str).setDate()` を使うと JST では通って本番だけ
 *    1日ズレるので、`addDaysJst`（UTC 0時基準 + epoch 加算）に揃えている。
 *    テストは package.json の test スクリプトで TZ=UTC 固定。
 */

import { addDaysJst } from "@/lib/date";
import {
  minAdvanceDaysOf,
  earliestBookableDate,
  validateReservationSlot,
} from "@/lib/reservations";
import type { Facility } from "@/types";

/** 土日も含めて毎日営業の施設（曜日で弾かれないようにして、リードタイムだけを見る） */
function facility(overrides: Partial<Facility> = {}): Facility {
  return {
    id: "sauna",
    name: "サウナ",
    type: "activity",
    capacity: 4,
    calendarId: "cal@example.com",
    openTime: "10:00",
    closeTime: "22:00",
    availableDays: [0, 1, 2, 3, 4, 5, 6],
    ...overrides,
  };
}

describe("minAdvanceDaysOf — 設定値の正規化", () => {
  test("未設定・0・負数・NaN は 0（制限なし）", () => {
    expect(minAdvanceDaysOf({})).toBe(0);
    expect(minAdvanceDaysOf({ minAdvanceDays: 0 })).toBe(0);
    expect(minAdvanceDaysOf({ minAdvanceDays: -3 })).toBe(0);
    expect(minAdvanceDaysOf({ minAdvanceDays: NaN })).toBe(0);
  });

  test("正の数はそのまま（小数は切り捨て）", () => {
    expect(minAdvanceDaysOf({ minAdvanceDays: 7 })).toBe(7);
    expect(minAdvanceDaysOf({ minAdvanceDays: 7.9 })).toBe(7);
  });
});

describe("earliestBookableDate — 予約できる最も早い日", () => {
  test("制限なしなら今日", () => {
    expect(earliestBookableDate({}, "2026-07-30")).toBe("2026-07-30");
  });

  test("7日前必須なら、ちょうど1週間後", () => {
    expect(earliestBookableDate({ minAdvanceDays: 7 }, "2026-07-30")).toBe("2026-08-06");
  });

  test("月をまたいでも正しい", () => {
    expect(earliestBookableDate({ minAdvanceDays: 7 }, "2026-07-28")).toBe("2026-08-04");
  });

  test("うるう日をまたいでも正しい", () => {
    expect(earliestBookableDate({ minAdvanceDays: 7 }, "2028-02-25")).toBe("2028-03-03");
  });

  test("年をまたいでも正しい", () => {
    expect(earliestBookableDate({ minAdvanceDays: 7 }, "2026-12-28")).toBe("2027-01-04");
  });
});

describe("addDaysJst — TZ に依存しない日付加算", () => {
  test("加算・減算ともに UTC 基準で安定している", () => {
    expect(addDaysJst("2026-07-30", 7)).toBe("2026-08-06");
    expect(addDaysJst("2026-08-06", -7)).toBe("2026-07-30");
    expect(addDaysJst("2026-07-30", 0)).toBe("2026-07-30");
  });

  test("月末・年末の繰り上がり", () => {
    expect(addDaysJst("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysJst("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("validateReservationSlot — 直前予約を弾く", () => {
  const slot = { startTime: "17:00", endTime: "18:00" };

  /** todayJst() を固定して境界を検証する（実時刻に依存させない）。 */
  function withToday<T>(today: string, fn: () => T): T {
    const spy = jest
      .spyOn(Intl, "DateTimeFormat")
      .mockImplementation(() => ({ format: () => today }) as unknown as Intl.DateTimeFormat);
    try {
      return fn();
    } finally {
      spy.mockRestore();
    }
  }

  test("ちょうど7日後は予約できる（1週間前ジャストはOK）", () => {
    withToday("2026-07-30", () => {
      const res = validateReservationSlot(facility({ minAdvanceDays: 7 }), {
        date: "2026-08-06",
        ...slot,
      });
      expect(res.ok).toBe(true);
    });
  });

  test("6日後は TOO_SOON で弾かれる", () => {
    withToday("2026-07-30", () => {
      const res = validateReservationSlot(facility({ minAdvanceDays: 7 }), {
        date: "2026-08-05",
        ...slot,
      });
      expect(res.ok).toBe(false);
      expect(res.reason).toBe("TOO_SOON");
      expect(res.message).toContain("7日前");
    });
  });

  test("当日も TOO_SOON（過去日ではないので PAST_DATE ではない）", () => {
    withToday("2026-07-30", () => {
      const res = validateReservationSlot(facility({ minAdvanceDays: 7 }), {
        date: "2026-07-30",
        ...slot,
      });
      expect(res.ok).toBe(false);
      expect(res.reason).toBe("TOO_SOON");
    });
  });

  test("8日後以降は当然OK", () => {
    withToday("2026-07-30", () => {
      expect(
        validateReservationSlot(facility({ minAdvanceDays: 7 }), { date: "2026-08-20", ...slot }).ok
      ).toBe(true);
    });
  });

  test("過去日は TOO_SOON ではなく PAST_DATE（利用者に理由を出し分ける）", () => {
    withToday("2026-07-30", () => {
      const res = validateReservationSlot(facility({ minAdvanceDays: 7 }), {
        date: "2026-07-01",
        ...slot,
      });
      expect(res.reason).toBe("PAST_DATE");
    });
  });

  test("minAdvanceDays 未設定の既存施設は当日でも予約できる（無影響）", () => {
    withToday("2026-07-30", () => {
      expect(validateReservationSlot(facility(), { date: "2026-07-30", ...slot }).ok).toBe(true);
    });
  });

  test("リードタイムを満たしていても曜日が違えば OUT_OF_HOURS（判定順の回帰）", () => {
    withToday("2026-07-30", () => {
      // 2026-08-06 は木曜。土曜のみの施設では曜日で弾かれる
      const res = validateReservationSlot(
        facility({ minAdvanceDays: 7, availableDays: [6] }),
        { date: "2026-08-06", ...slot }
      );
      expect(res.ok).toBe(false);
      expect(res.reason).toBe("OUT_OF_HOURS");
    });
  });
});
