import { daysUntil, canCancelMahjong } from "./date";

describe("キャンセル期限（前日まで可・当日以降不可）", () => {
  const today = "2026-07-01";
  afterEach(() => jest.useRealTimers());
  it("daysUntil 境界", () => {
    expect(daysUntil("2026-07-02", today)).toBe(1);
    expect(daysUntil("2026-07-01", today)).toBe(0);
    expect(daysUntil("2026-06-30", today)).toBe(-1);
  });
  it("前日まで可、当日・過去は不可", () => {
    expect(canCancelMahjong("2026-07-02", today)).toBe(true);
    expect(canCancelMahjong("2026-07-03", today)).toBe(true);
    expect(canCancelMahjong("2026-07-01", today)).toBe(false);
    expect(canCancelMahjong("2026-06-30", today)).toBe(false);
  });
  it.each([
    ["2026-10-09T14:59:59.000Z", true],
    ["2026-10-09T15:00:00.000Z", false],
  ])("TZ=UTCでもJST境界で判定: %s", (instant, allowed) => {
    expect(process.env.TZ).toBe("UTC");
    jest.useFakeTimers().setSystemTime(new Date(instant));
    expect(canCancelMahjong("2026-10-10")).toBe(allowed);
  });
});
