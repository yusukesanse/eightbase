/**
 * 単体テスト: deriveRanksFromPoints（持ち点から着順を振り直す）
 *
 * 背景（2026-08-01・本番）:
 *   管理画面の手入力フォームが「1位/2位/3位/4位」の行を固定にしていたため、
 *   入力者が点数順に並べ替えずに入れた結果、点数と着順が逆転した卓が5つできた。
 *   `validateTableReports` の最後の整合性チェック（点数が多いのに順位が下はNG）に落ちて
 *   すべて「申告待ち」＝集計対象外になった。
 *   麻雀の着順は持ち点で決まるので、着順は入力させず点数から導く。
 */
import { deriveRanksFromPoints, validateTableReports } from "@/lib/mahjong";
import type { MahjongTableMember } from "@/types";

const m = (displayName: string, points: number | null, rank: number | null): MahjongTableMember => ({
  lineUserId: `U-${displayName}`,
  displayName,
  points,
  rank,
  reportedAt: points === null ? null : "2026-08-01T00:00:00.000Z",
});

describe("deriveRanksFromPoints", () => {
  test("持ち点の多い順に1〜4位を振る", () => {
    const out = deriveRanksFromPoints([
      m("A", 35200, 1), m("B", 43900, 2), m("C", 9500, 3), m("D", 11400, 4),
    ]);
    expect(out.map((x) => [x.displayName, x.rank])).toEqual([
      ["A", 2], ["B", 1], ["C", 4], ["D", 3],
    ]);
  });

  test("マイナス点でも正しく最下位になる", () => {
    const out = deriveRanksFromPoints([
      m("A", 28100, 1), m("B", 62000, 2), m("C", 33700, 3), m("D", -23800, 4),
    ]);
    expect(out.map((x) => x.rank)).toEqual([3, 1, 2, 4]);
  });

  test("同点は元の並び順で先に来た方を上位にする（決定的）", () => {
    const out = deriveRanksFromPoints([m("A", 30000, 1), m("B", 30000, 2), m("C", 25000, 3), m("D", 15000, 4)]);
    expect(out.map((x) => x.rank)).toEqual([1, 2, 3, 4]);
  });

  test("未申告(null)は着順を触らず最後尾に置く", () => {
    const out = deriveRanksFromPoints([m("A", 40000, null), m("B", null, null), m("C", 35000, null), m("D", 25000, null)]);
    expect(out.map((x) => x.rank)).toEqual([1, null, 2, 3]);
  });
});

describe("振り直すと検証に通る（本番で詰まった5卓の再現）", () => {
  /** 2026-08-01 の実データ。合計はちょうど100,000点だが着順だけが逆転していた。 */
  const REAL_CASES: [string, [string, number][]][] = [
    ["第1半荘", [["永井", 35200], ["加藤", 43900], ["川瀬", 9500], ["松田", 11400]]],
    ["第2半荘", [["龍ヶ江", 28100], ["金原", 62000], ["秋山", 33700], ["木下", -23800]]],
    ["第3半荘", [["永井", 28000], ["加藤", 55200], ["金原", 7000], ["秋山", 9800]]],
    ["第4半荘", [["川瀬", 22200], ["松田", 14100], ["龍ヶ江", 21500], ["木下", 42200]]],
    ["第5半荘", [["永井", 44900], ["加藤", 13800], ["木下", 21500], ["川瀬", 19800]]],
  ];

  test.each(REAL_CASES)("%s: 行順の着順では検証に落ちるが、振り直せば通る", (_label, rows) => {
    // 行順で着順を付けた場合（＝旧フォームの挙動）
    const asEntered = rows.map(([name, pts], i) => m(name, pts, i + 1));
    expect(asEntered.reduce((s, x) => s + (x.points as number), 0)).toBe(100000); // 合計は正しい
    expect(validateTableReports(asEntered).ok).toBe(false);
    expect(validateTableReports(asEntered).error).toMatch(/点数と順位が一致しません/);

    // 持ち点から振り直すと通る
    const fixed = deriveRanksFromPoints(asEntered);
    const v = validateTableReports(fixed);
    expect(v.ok).toBe(true);
    expect(v.total).toBe(100000);
    // 1位は最高得点の人
    const top = [...rows].sort((a, b) => b[1] - a[1])[0][0];
    expect(fixed.find((x) => x.rank === 1)!.displayName).toBe(top);
  });

  test("合計が100,000点でない卓は振り直しても通らない（順位を壊さない）", () => {
    const bad = [m("A", 40000, 1), m("B", 30000, 2), m("C", 20000, 3), m("D", 5000, 4)]; // 95,000
    const v = validateTableReports(deriveRanksFromPoints(bad));
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/100,000/);
  });
});
