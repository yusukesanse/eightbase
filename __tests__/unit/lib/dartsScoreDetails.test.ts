/**
 * 単体テスト（再発防止）: 管理スコアAPIの darts details 検証（厳格版）。
 * 3種目厳密・範囲・firstCount整合・teamId規則・totalScore整合・旧スキーマ範囲。
 */
import { validateDartsScoreDetails } from "@/lib/dartsScore";

// 妥当な3種目（合計 8+5.5+3.5 = 17・rank1 は zeroOne のみ＝firstCount 1）。
const valid = () => ({
  events: [
    { kind: "zeroOne", points: 8, value: 0, rank: 1 },
    { kind: "countUp", points: 5.5, value: 500, rank: 2 },
    { kind: "cricket", points: 3.5, value: 60, rank: 3, teamId: "t1" },
  ],
  dayRank: 1,
  firstCount: 1,
});
const V_TOTAL = 17;

describe("新スキーマ: 正常", () => {
  test("妥当な3種目は null（totalScore 整合も）", () => {
    expect(validateDartsScoreDetails(valid(), V_TOTAL)).toBeNull();
  });
});

describe("新スキーマ: events 件数/kind", () => {
  test.each([0, 1, 2, 4])("events %i 件は不可", (n) => {
    const d = valid();
    d.events = d.events.slice(0, n);
    while (d.events.length < n) d.events.push({ kind: "cricket", points: 1, value: 0, rank: 4, teamId: "t9" });
    expect(validateDartsScoreDetails(d)).not.toBeNull();
  });
  test("不明な kind を弾く", () => {
    const d = valid(); d.events[2] = { kind: "hoge", points: 1, value: 0, rank: 3 } as never;
    expect(validateDartsScoreDetails(d)).toMatch(/不明な種目/);
  });
  test("kind 重複を弾く", () => {
    const d = valid(); d.events[2] = { kind: "zeroOne", points: 1, value: 0, rank: 3 } as never;
    expect(validateDartsScoreDetails(d)).toMatch(/重複/);
  });
});

describe("新スキーマ: 数値範囲", () => {
  test("負数 points", () => { const d = valid(); d.events[0].points = -1; expect(validateDartsScoreDetails(d)).not.toBeNull(); });
  test("points > 8", () => { const d = valid(); d.events[0].points = 9; expect(validateDartsScoreDetails(d)).not.toBeNull(); });
  test("NaN / Infinity points", () => {
    const a = valid(); a.events[0].points = NaN; expect(validateDartsScoreDetails(a)).not.toBeNull();
    const b = valid(); b.events[0].points = Infinity; expect(validateDartsScoreDetails(b)).not.toBeNull();
  });
  test("小数 rank", () => { const d = valid(); d.events[0].rank = 1.5; expect(validateDartsScoreDetails(d)).not.toBeNull(); });
  test("rank 範囲外(0/9)", () => {
    const a = valid(); a.events[0].rank = 0; expect(validateDartsScoreDetails(a)).not.toBeNull();
    const b = valid(); b.events[0].rank = 9; expect(validateDartsScoreDetails(b)).not.toBeNull();
  });
  test("value は null か 0以上の整数", () => {
    const nul = valid(); nul.events[0].value = null as never; expect(validateDartsScoreDetails(nul, V_TOTAL)).toBeNull();
    const neg = valid(); neg.events[0].value = -1; expect(validateDartsScoreDetails(neg)).not.toBeNull();
    const flt = valid(); flt.events[0].value = 1.5; expect(validateDartsScoreDetails(flt)).not.toBeNull();
  });
  test("dayRank 0/9 は不可", () => {
    const a = valid(); a.dayRank = 0; expect(validateDartsScoreDetails(a)).not.toBeNull();
    const b = valid(); b.dayRank = 9; expect(validateDartsScoreDetails(b)).not.toBeNull();
  });
  test("firstCount -1/4 は不可", () => {
    const a = valid(); a.firstCount = -1; expect(validateDartsScoreDetails(a)).not.toBeNull();
    const b = valid(); b.firstCount = 4; expect(validateDartsScoreDetails(b)).not.toBeNull();
  });
});

describe("新スキーマ: 整合性", () => {
  test("firstCount と rank===1 件数の不一致", () => {
    const d = valid(); d.firstCount = 2; // rank1 は1件
    expect(validateDartsScoreDetails(d)).toMatch(/firstCount/);
  });
  test("totalScore 不一致", () => {
    expect(validateDartsScoreDetails(valid(), 99)).toMatch(/totalScore/);
  });
});

describe("新スキーマ: teamId 規則", () => {
  test("cricket 以外の teamId は不可", () => {
    const d = valid(); (d.events[0] as { teamId?: string }).teamId = "t1";
    expect(validateDartsScoreDetails(d)).toMatch(/teamId/);
  });
  test("cricket の危険な teamId は不可", () => {
    const d = valid(); d.events[2].teamId = "__proto__";
    expect(validateDartsScoreDetails(d)).not.toBeNull();
  });
});

describe("旧スキーマ（後方互換）", () => {
  test("正常は null", () => expect(validateDartsScoreDetails({ rank: 1, points: 8 })).toBeNull());
  test("rank 範囲外/小数", () => {
    expect(validateDartsScoreDetails({ rank: 9, points: 8 })).not.toBeNull();
    expect(validateDartsScoreDetails({ rank: 1.5, points: 8 })).not.toBeNull();
  });
  test("points 範囲外/NaN", () => {
    expect(validateDartsScoreDetails({ rank: 1, points: 9 })).not.toBeNull();
    expect(validateDartsScoreDetails({ rank: 1, points: NaN })).not.toBeNull();
  });
  test("totalScore 不一致", () => {
    expect(validateDartsScoreDetails({ rank: 1, points: 8 }, 3)).not.toBeNull();
  });
});
