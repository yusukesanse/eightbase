import { daysUntil, canCancelMahjong } from "./date";

describe("キャンセル期限（7日前まで可・6日前以降不可）", () => {
  const today = "2026-07-01";
  it("daysUntil 境界", () => {
    expect(daysUntil("2026-07-08", today)).toBe(7);
    expect(daysUntil("2026-07-07", today)).toBe(6);
    expect(daysUntil("2026-07-01", today)).toBe(0);
  });
  it("7日前は解除可、6日前以降は不可", () => {
    expect(canCancelMahjong("2026-07-08", today)).toBe(true); // ちょうど7日前
    expect(canCancelMahjong("2026-07-09", today)).toBe(true); // 8日前
    expect(canCancelMahjong("2026-07-07", today)).toBe(false); // 6日前
    expect(canCancelMahjong("2026-07-01", today)).toBe(false); // 当日
  });
});
