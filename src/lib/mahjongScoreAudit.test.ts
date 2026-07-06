import { isAnomalousScores } from "./mahjongScoreAudit";

describe("自己申告スコアの異常検知", () => {
  it("通常の分布はフラグしない", () => {
    expect(isAnomalousScores([45000, 28000, 18000, 9000]).flagged).toBe(false);
    expect(isAnomalousScores([55000, 25000, 15000, 5000]).flagged).toBe(false);
  });
  it("1人が70%以上を占有したらフラグ（結託疑い）", () => {
    expect(isAnomalousScores([97000, 1000, 1000, 1000]).flagged).toBe(true);
    expect(isAnomalousScores([70000, 20000, 5000, 5000]).flagged).toBe(true);
  });
  it("境界: ちょうど70%はフラグ、69%はしない", () => {
    expect(isAnomalousScores([70000, 30000]).flagged).toBe(true);
    expect(isAnomalousScores([69000, 31000]).flagged).toBe(false);
  });
});
