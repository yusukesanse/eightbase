/**
 * 単体テスト: src/lib/calendarBusy.ts
 *
 * 背景（2026-08-06）: Google カレンダーから直接入れたトレーラーの予約が、
 * ミニアプリ側では空きに見えて予約できてしまった。旧 `getBookedSlots` は
 * **終日予定を 00:00〜00:00（長さゼロ）** として扱っており、まったく塞いでいなかった。
 *
 * 固定する仕様:
 *  - 終日予定はその日を丸ごと塞ぐ（00:00〜24:00）
 *  - 日をまたぐ予定はその日の範囲に切り詰める（JST基準・本番 TZ=UTC でもズレない）
 *  - cancelled / transparency=transparent は塞がない
 *  - 予約確定前ガードは、重なれば ALREADY_BOOKED、GCalが読めなければ CALENDAR_UNAVAILABLE を投げる
 *  - calendarId 未設定（GCal連携なし）の施設は GCal を叩かない
 * TZ=UTC で実行（package.json）。
 */
const mockList = jest.fn();
jest.mock("@/lib/googleCalendar", () => ({
  listCalendarEvents: (...args: unknown[]) => mockList(...args),
}));

import {
  busyIntervalsForDate,
  getCalendarBusySlotsByDate,
  getCalendarBusySlotsSafe,
  assertCalendarSlotFree,
} from "@/lib/calendarBusy";

const DATE = "2026-08-08";

beforeEach(() => mockList.mockReset());

describe("busyIntervalsForDate — GCalの予定を その日(JST)の占有時間帯へ", () => {
  test("時刻つきの予定はそのまま JST の HH:mm に", () => {
    expect(
      busyIntervalsForDate(
        [{ start: { dateTime: `${DATE}T13:00:00+09:00` }, end: { dateTime: `${DATE}T15:30:00+09:00` } }],
        DATE
      )
    ).toEqual([{ start: "13:00", end: "15:30" }]);
  });

  test("UTC表記で来ても JST に直す（本番 TZ=UTC でもズレない）", () => {
    expect(
      busyIntervalsForDate(
        [{ start: { dateTime: "2026-08-08T01:00:00Z" }, end: { dateTime: "2026-08-08T03:00:00Z" } }],
        DATE
      )
    ).toEqual([{ start: "10:00", end: "12:00" }]);
  });

  test("★終日予定はその日を丸ごと塞ぐ（旧実装はここを素通りさせていた）", () => {
    expect(
      busyIntervalsForDate([{ start: { date: DATE }, end: { date: "2026-08-09" } }], DATE)
    ).toEqual([{ start: "00:00", end: "24:00" }]);
  });

  test("複数日の終日予定は、その日も丸ごと塞ぐ", () => {
    const ev = [{ start: { date: "2026-08-07" }, end: { date: "2026-08-10" } }];
    expect(busyIntervalsForDate(ev, DATE)).toEqual([{ start: "00:00", end: "24:00" }]);
    expect(busyIntervalsForDate(ev, "2026-08-10")).toEqual([]); // end.date は排他
  });

  test("日をまたぐ予定は、その日の範囲に切り詰める", () => {
    const ev = [
      { start: { dateTime: `${DATE}T22:00:00+09:00` }, end: { dateTime: "2026-08-09T02:00:00+09:00" } },
    ];
    expect(busyIntervalsForDate(ev, DATE)).toEqual([{ start: "22:00", end: "24:00" }]);
    expect(busyIntervalsForDate(ev, "2026-08-09")).toEqual([{ start: "00:00", end: "02:00" }]);
  });

  test("キャンセル済み・空き時間(transparent)・別日の予定は塞がない", () => {
    const events = [
      { status: "cancelled", start: { dateTime: `${DATE}T10:00:00+09:00` }, end: { dateTime: `${DATE}T11:00:00+09:00` } },
      { transparency: "transparent", start: { dateTime: `${DATE}T12:00:00+09:00` }, end: { dateTime: `${DATE}T13:00:00+09:00` } },
      { start: { dateTime: "2026-08-09T10:00:00+09:00" }, end: { dateTime: "2026-08-09T11:00:00+09:00" } },
    ];
    expect(busyIntervalsForDate(events, DATE)).toEqual([]);
  });

  test("ignoreEventIds のイベントは無視する（自分のミラーを除外する用途）", () => {
    const events = [
      { id: "ev-mine", start: { dateTime: `${DATE}T10:00:00+09:00` }, end: { dateTime: `${DATE}T11:00:00+09:00` } },
      { id: "ev-other", start: { dateTime: `${DATE}T14:00:00+09:00` }, end: { dateTime: `${DATE}T15:00:00+09:00` } },
    ];
    expect(busyIntervalsForDate(events, DATE, { ignoreEventIds: ["ev-mine"] })).toEqual([
      { start: "14:00", end: "15:00" },
    ]);
  });
});

describe("getCalendarBusySlotsByDate — 複数日を1リクエストで", () => {
  test("7日ぶんでも events.list は1回だけ", async () => {
    mockList.mockResolvedValue([
      { start: { date: "2026-08-09" }, end: { date: "2026-08-10" } },
      { start: { dateTime: `${DATE}T09:00:00+09:00` }, end: { dateTime: `${DATE}T10:00:00+09:00` } },
    ]);
    const dates = Array.from({ length: 7 }, (_, i) => `2026-08-0${8 + i}`.slice(0, 10));
    const res = await getCalendarBusySlotsByDate("cal-a", ["2026-08-08", "2026-08-09", "2026-08-10"]);
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(res["2026-08-08"]).toEqual([{ start: "09:00", end: "10:00" }]);
    expect(res["2026-08-09"]).toEqual([{ start: "00:00", end: "24:00" }]);
    expect(res["2026-08-10"]).toEqual([]);
    expect(dates.length).toBe(7);
  });

  test("calendarId 未設定なら GCal を叩かない", async () => {
    expect(await getCalendarBusySlotsByDate("", [DATE])).toEqual({});
    expect(await getCalendarBusySlotsByDate(null, [DATE])).toEqual({});
    expect(mockList).not.toHaveBeenCalled();
  });

  test("Safe 版は取得失敗を握りつぶす（表示を止めない）", async () => {
    mockList.mockRejectedValue(new Error("boom"));
    expect(await getCalendarBusySlotsSafe("cal-a", [DATE])).toEqual({});
  });
});

describe("assertCalendarSlotFree — 予約確定前のガード", () => {
  test("GCalの予定と重なれば ALREADY_BOOKED", async () => {
    mockList.mockResolvedValue([
      { start: { dateTime: `${DATE}T13:00:00+09:00` }, end: { dateTime: `${DATE}T15:00:00+09:00` } },
    ]);
    await expect(
      assertCalendarSlotFree("cal-a", { date: DATE, startTime: "14:00", endTime: "16:00" })
    ).rejects.toThrow("ALREADY_BOOKED");
  });

  test("★終日予定があるとその日は一切予約できない", async () => {
    mockList.mockResolvedValue([{ start: { date: DATE }, end: { date: "2026-08-09" } }]);
    await expect(
      assertCalendarSlotFree("cal-a", { date: DATE, startTime: "10:00", endTime: "12:00" })
    ).rejects.toThrow("ALREADY_BOOKED");
  });

  test("隣接（前の予定の終了＝開始）は通す", async () => {
    mockList.mockResolvedValue([
      { start: { dateTime: `${DATE}T10:00:00+09:00` }, end: { dateTime: `${DATE}T12:00:00+09:00` } },
    ]);
    await expect(
      assertCalendarSlotFree("cal-a", { date: DATE, startTime: "12:00", endTime: "14:00" })
    ).resolves.toBeUndefined();
  });

  test("GCalが読めないときは通さない（CALENDAR_UNAVAILABLE）", async () => {
    mockList.mockRejectedValue(new Error("network"));
    await expect(
      assertCalendarSlotFree("cal-a", { date: DATE, startTime: "10:00", endTime: "12:00" })
    ).rejects.toThrow("CALENDAR_UNAVAILABLE");
  });

  test("calendarId 未設定の施設は GCal を叩かずに通す（連携なし）", async () => {
    await expect(
      assertCalendarSlotFree("", { date: DATE, startTime: "10:00", endTime: "12:00" })
    ).resolves.toBeUndefined();
    expect(mockList).not.toHaveBeenCalled();
  });
});
