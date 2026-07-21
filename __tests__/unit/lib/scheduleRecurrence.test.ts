/**
 * 単体テスト: 開催日の繰り返し生成（曜日×間隔×期間）。
 */
import { generateRecurringDates, partitionScheduleForDelete } from "@/lib/scheduleRecurrence";

describe("generateRecurringDates", () => {
  test("毎週土曜（weekday=6, interval=1）", () => {
    expect(generateRecurringDates({ weekday: 6, intervalWeeks: 1, startDate: "2026-07-01", endDate: "2026-07-31" }))
      .toEqual(["2026-07-04", "2026-07-11", "2026-07-18", "2026-07-25"]);
  });
  test("隔週木曜（weekday=4, interval=2）", () => {
    expect(generateRecurringDates({ weekday: 4, intervalWeeks: 2, startDate: "2026-07-01", endDate: "2026-08-15" }))
      .toEqual(["2026-07-02", "2026-07-16", "2026-07-30", "2026-08-13"]);
  });
  test("3週に1回・日曜（weekday=0, interval=3）", () => {
    expect(generateRecurringDates({ weekday: 0, intervalWeeks: 3, startDate: "2026-07-05", endDate: "2026-09-01" }))
      .toEqual(["2026-07-05", "2026-07-26", "2026-08-16"]);
  });
  test("起点がその曜日ならその日から", () => {
    expect(generateRecurringDates({ weekday: 6, intervalWeeks: 1, startDate: "2026-07-04", endDate: "2026-07-18" }))
      .toEqual(["2026-07-04", "2026-07-11", "2026-07-18"]);
  });
  test("不正入力は空配列", () => {
    expect(generateRecurringDates({ weekday: 7, intervalWeeks: 1, startDate: "2026-07-01", endDate: "2026-07-31" })).toEqual([]);
    expect(generateRecurringDates({ weekday: 6, intervalWeeks: 0, startDate: "2026-07-01", endDate: "2026-07-31" })).toEqual([]);
    expect(generateRecurringDates({ weekday: 6, intervalWeeks: 1, startDate: "2026-08-01", endDate: "2026-07-01" })).toEqual([]);
    expect(generateRecurringDates({ weekday: 6, intervalWeeks: 1, startDate: "bad", endDate: "2026-07-31" })).toEqual([]);
  });
});

describe("partitionScheduleForDelete（一括削除・参加者保護）", () => {
  const sched = ["2026-07-04", "2026-07-11", "2026-07-18", "2026-07-25"];
  test("全削除: 参加者ありの日はスキップ", () => {
    const r = partitionScheduleForDelete(sched, new Set(["2026-07-11"]), { all: true });
    expect(r.toDelete).toEqual(["2026-07-04", "2026-07-18", "2026-07-25"]);
    expect(r.skipped).toEqual(["2026-07-11"]);
  });
  test("期間指定: 範囲内のみ対象（参加者は保護）", () => {
    const r = partitionScheduleForDelete(sched, new Set(["2026-07-18"]), { from: "2026-07-10", to: "2026-07-20" });
    expect(r.toDelete).toEqual(["2026-07-11"]);
    expect(r.skipped).toEqual(["2026-07-18"]);
  });
  test("参加者なし全削除", () => {
    const r = partitionScheduleForDelete(sched, new Set(), { all: true });
    expect(r.toDelete).toEqual(sched);
    expect(r.skipped).toEqual([]);
  });
});
