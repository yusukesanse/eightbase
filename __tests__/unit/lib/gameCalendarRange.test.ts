/**
 * 単体テスト: src/lib/gameCalendarRange.ts
 * ゲーム参加タブのカレンダーを「どこまで過去へ遡れるか」（4種目共通）。
 * TZ=UTC で実行（package.json）。日付は "YYYY-MM-DD" / 月は "YYYY-MM"。
 */
import { calendarMinMonth, canBrowsePastMonths } from "@/lib/gameCalendarRange";

describe("calendarMinMonth", () => {
  it("開催日集合の最も古い月を返す", () => {
    const schedule = new Set(["2026-08-01", "2026-06-13", "2026-07-11"]);
    expect(calendarMinMonth(schedule)).toBe("2026-06");
  });

  it("複数のソースをまたいで最小を取る（参加日・シーズン開始日を含む）", () => {
    const schedule = new Set(["2026-08-01"]);
    const entered = new Set(["2026-07-11"]);
    expect(calendarMinMonth(schedule, entered, "2026-05-01")).toBe("2026-05");
  });

  it("日程未登録（空集合）でもシーズン開始日だけで下限を決められる", () => {
    // 麻雀の「毎週土曜」フォールバックのシーズンを想定。
    expect(calendarMinMonth(new Set<string>(), new Set<string>(), "2026-04-01")).toBe("2026-04");
  });

  it("材料が1件も無ければ undefined（＝当月止まり＝従来どおり）", () => {
    expect(calendarMinMonth(new Set<string>(), undefined, null)).toBeUndefined();
    expect(calendarMinMonth()).toBeUndefined();
  });

  it("不正な形式の値は無視する（下限を壊さない）", () => {
    expect(calendarMinMonth(["2026-07", "", "not-a-date", "2026-09-05"])).toBe("2026-09");
  });

  it("年跨ぎでも文字列比較で正しく最小になる", () => {
    expect(calendarMinMonth(["2026-01-10", "2025-12-27"])).toBe("2025-12");
  });
});

describe("canBrowsePastMonths（案内文の出し分け）", () => {
  it("下限が今月より前なら true", () => {
    expect(canBrowsePastMonths("2026-06", "2026-08-10")).toBe(true);
  });

  it("下限が今月と同じなら false（「‹」は押せないので案内も出さない）", () => {
    expect(canBrowsePastMonths("2026-08", "2026-08-10")).toBe(false);
  });

  it("下限が未来（シーズン未開始）でも false", () => {
    expect(canBrowsePastMonths("2026-09", "2026-08-10")).toBe(false);
  });

  it("下限が無ければ false", () => {
    expect(canBrowsePastMonths(undefined, "2026-08-10")).toBe(false);
  });
});
