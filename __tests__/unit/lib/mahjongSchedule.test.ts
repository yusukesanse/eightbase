/**
 * 単体テスト: 麻雀日程のスケジュール移行（純関数）。
 * - resolveMahjongEventDate: schedule 駆動 / 未移行フォールバック（土曜−休催）
 * - generateWeeklySaturdays: シーズン期間の毎週土曜
 */
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: () => ({}) }));

import { resolveMahjongEventDate, generateWeeklySaturdays } from "@/lib/mahjongSchedule";

describe("resolveMahjongEventDate", () => {
  test("schedule 駆動: 集合に含まれる日のみ有効（曜日は不問＝日曜もOK）", () => {
    const scheduled = ["2026-07-19", "2026-07-25"]; // 日曜・土曜
    expect(resolveMahjongEventDate({ scheduledDates: scheduled, date: "2026-07-19", isSaturday: false, isClosed: false })).toBe(true);
    expect(resolveMahjongEventDate({ scheduledDates: scheduled, date: "2026-07-25", isSaturday: true, isClosed: false })).toBe(true);
    expect(resolveMahjongEventDate({ scheduledDates: scheduled, date: "2026-07-18", isSaturday: true, isClosed: false })).toBe(false); // 土曜でもschedule外は不可
  });
  test("未移行（schedule空）: 土曜かつ非休催のみ有効", () => {
    expect(resolveMahjongEventDate({ scheduledDates: [], date: "2026-07-18", isSaturday: true, isClosed: false })).toBe(true);
    expect(resolveMahjongEventDate({ scheduledDates: [], date: "2026-07-18", isSaturday: true, isClosed: true })).toBe(false); // 休催
    expect(resolveMahjongEventDate({ scheduledDates: [], date: "2026-07-19", isSaturday: false, isClosed: false })).toBe(false); // 日曜
  });
});

describe("generateWeeklySaturdays", () => {
  test("期間内の毎週土曜（両端含む・起点が土曜でなくても最初の土曜から）", () => {
    expect(generateWeeklySaturdays("2026-07-01", "2026-07-31")).toEqual([
      "2026-07-04", "2026-07-11", "2026-07-18", "2026-07-25",
    ]);
  });
  test("起点が土曜ならその日から", () => {
    expect(generateWeeklySaturdays("2026-07-04", "2026-07-18")).toEqual(["2026-07-04", "2026-07-11", "2026-07-18"]);
  });
  test("不正範囲は空", () => {
    expect(generateWeeklySaturdays("2026-08-01", "2026-07-01")).toEqual([]);
    expect(generateWeeklySaturdays("bad", "2026-07-01")).toEqual([]);
  });
});
