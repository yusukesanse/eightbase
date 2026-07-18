/**
 * 単体テスト: src/lib/dartsScore.ts
 * 要件 docs/games/darts/ダーツ-ルール草案.md §3 の例と一致することを検証。
 */
import {
  rankPoint,
  computeEventPoints,
  computeCricketPoints,
  rankDay,
} from "@/lib/dartsScore";
import { DARTS_POINT_TABLE } from "@/types/darts";

/* ───────── 正規化配点表 ───────── */
describe("rankPoint / DARTS_POINT_TABLE", () => {
  test("両端は常に 1位=8・最下位=1（人数インフレ防止）", () => {
    for (let n = 2; n <= 8; n++) {
      expect(rankPoint(n, 1)).toBe(8);
      expect(rankPoint(n, n)).toBe(1);
    }
  });

  test("各人数の合計（種目ごとの配点合計）", () => {
    const sum = (n: number) => DARTS_POINT_TABLE[n].reduce((s, x) => s + x, 0);
    expect(sum(4)).toBe(8 + 5.5 + 3.5 + 1); // 18
    expect(sum(6)).toBe(8 + 6.5 + 5 + 4 + 2.5 + 1); // 27
    expect(sum(8)).toBe(36);
  });

  test("範囲外は端に丸める", () => {
    expect(rankPoint(0, 1)).toBe(8); // n<1 → 1人扱い
    expect(rankPoint(8, 99)).toBe(1); // rank超過 → 最下位
    expect(rankPoint(99, 1)).toBe(8); // n>8 → 8人表
  });
});

/* ───────── 種目内の順位・ポイント（同点平均） ───────── */
describe("computeEventPoints", () => {
  test("カウントアップ（合計点の高い順）", () => {
    const r = computeEventPoints(
      [
        { id: "A", value: 500 },
        { id: "B", value: 300 },
        { id: "C", value: 400 },
        { id: "D", value: 200 },
      ],
      true
    );
    const by = Object.fromEntries(r.map((x) => [x.id, x]));
    expect(by.A.rank).toBe(1);
    expect(by.A.points).toBe(8);
    expect(by.C.rank).toBe(2);
    expect(by.C.points).toBe(5.5);
    expect(by.D.rank).toBe(4);
    expect(by.D.points).toBe(1);
  });

  test("ゼロワン（残り点の少ない順・0は最上位）", () => {
    const r = computeEventPoints(
      [
        { id: "A", value: 0 },
        { id: "B", value: 20 },
        { id: "C", value: 5 },
        { id: "D", value: 60 },
      ],
      false
    );
    const by = Object.fromEntries(r.map((x) => [x.id, x]));
    expect(by.A.rank).toBe(1); // 残り0=上がり
    expect(by.C.rank).toBe(2);
    expect(by.B.rank).toBe(3);
    expect(by.D.rank).toBe(4);
  });

  test("ゼロワン 0が2人=1位タイ → 平均分配 7.5（§3.1）", () => {
    const r = computeEventPoints(
      [
        { id: "A", value: 0 },
        { id: "B", value: 0 },
        { id: "C", value: 30 },
        { id: "D", value: 10 },
        { id: "E", value: 50 },
        { id: "F", value: 40 },
        { id: "G", value: 20 },
        { id: "H", value: 5 },
      ],
      false
    );
    const by = Object.fromEntries(r.map((x) => [x.id, x]));
    expect(by.A.rank).toBe(1);
    expect(by.B.rank).toBe(1);
    expect(by.A.points).toBe(7.5); // (8+7)/2
    expect(by.B.points).toBe(7.5);
    // 次は3位（2位を飛ばす）
    const third = r.find((x) => x.rank === 3);
    expect(third).toBeTruthy();
    expect(r.some((x) => x.rank === 2)).toBe(false);
  });

  test("欠席（value=null）は 0pt・人数に数えない", () => {
    const r = computeEventPoints(
      [
        { id: "A", value: 100 },
        { id: "B", value: 50 },
        { id: "C", value: null },
      ],
      true
    );
    const by = Object.fromEntries(r.map((x) => [x.id, x]));
    expect(by.C.points).toBe(0);
    expect(by.C.rank).toBeNull();
    // 実人数2名 → 1位8・2位1
    expect(by.A.points).toBe(8);
    expect(by.B.points).toBe(1);
  });
});

/* ───────── クリケット（チーム帯平均・§3.3） ───────── */
describe("computeCricketPoints", () => {
  test("8名4チーム: 7.5 / 5.5 / 3.5 / 1.5、合計は個人種目と一致(36)", () => {
    const r = computeCricketPoints([
      { teamId: "T1", points: 100, memberIds: ["a", "b"] },
      { teamId: "T2", points: 80, memberIds: ["c", "d"] },
      { teamId: "T3", points: 60, memberIds: ["e", "f"] },
      { teamId: "T4", points: 40, memberIds: ["g", "h"] },
    ]);
    const by = Object.fromEntries(r.map((x) => [x.id, x]));
    expect(by.a.points).toBe(7.5);
    expect(by.b.points).toBe(7.5);
    expect(by.c.points).toBe(5.5);
    expect(by.e.points).toBe(3.5);
    expect(by.g.points).toBe(1.5);
    expect(r.reduce((s, x) => s + x.points, 0)).toBe(36);
    expect(by.a.teamRank).toBe(1);
    expect(by.g.teamRank).toBe(4);
  });

  test("5名(2+2+1)の1人チームでも合計が個人種目(22.5)と一致", () => {
    const r = computeCricketPoints([
      { teamId: "T1", points: 100, memberIds: ["a", "b"] },
      { teamId: "T2", points: 70, memberIds: ["c", "d"] },
      { teamId: "T3", points: 30, memberIds: ["e"] }, // 1人チーム
    ]);
    const total = r.reduce((s, x) => s + x.points, 0);
    expect(total).toBeCloseTo(22.5, 6);
    const by = Object.fromEntries(r.map((x) => [x.id, x]));
    expect(by.e.points).toBe(1); // 単独最下位帯 = そのまま1
  });

  test("同ポイントのチームは同順位（帯を合体して平均）", () => {
    const r = computeCricketPoints([
      { teamId: "T1", points: 90, memberIds: ["a", "b"] },
      { teamId: "T2", points: 90, memberIds: ["c", "d"] }, // T1と同点
      { teamId: "T3", points: 50, memberIds: ["e", "f"] },
      { teamId: "T4", points: 30, memberIds: ["g", "h"] },
    ]);
    const by = Object.fromEntries(r.map((x) => [x.id, x]));
    // 上位2チーム同点 → 個人順位帯1..4の平均 (8+7+6+5)/4 = 6.5 を4名全員に
    expect(by.a.points).toBe(6.5);
    expect(by.c.points).toBe(6.5);
    expect(by.a.teamRank).toBe(1);
    expect(by.c.teamRank).toBe(1);
    // 合計は保存される(36)
    expect(r.reduce((s, x) => s + x.points, 0)).toBe(36);
  });
});

/* ───────── その日の総合順位・タイブレーク（§3.4） ───────── */
describe("rankDay", () => {
  test("§3.5 の例（4名）", () => {
    const r = rankDay([
      { id: "A", total: 21.5, ranks: [1, 2, 1] },
      { id: "B", total: 14.5, ranks: [2, 1, 4] },
      { id: "C", total: 7.5, ranks: [4, 4, 2] },
      { id: "D", total: 10.5, ranks: [3, 3, 3] },
    ]);
    const by = Object.fromEntries(r.map((x) => [x.id, x]));
    expect(by.A.dayRank).toBe(1);
    expect(by.B.dayRank).toBe(2);
    expect(by.D.dayRank).toBe(3);
    expect(by.C.dayRank).toBe(4);
  });

  test("総合同点は1位数の多い順（タイブレーク）", () => {
    const r = rankDay([
      { id: "X", total: 20, ranks: [1, 1, 3] }, // 1位2回
      { id: "Y", total: 20, ranks: [1, 2, 2] }, // 1位1回
    ]);
    const by = Object.fromEntries(r.map((x) => [x.id, x]));
    expect(by.X.dayRank).toBe(1);
    expect(by.Y.dayRank).toBe(2);
    expect(by.X.firstCount).toBe(2);
  });

  test("1位数も同じなら2位数で比較", () => {
    const r = rankDay([
      { id: "X", total: 20, ranks: [1, 2, 4] }, // 1位1・2位1
      { id: "Y", total: 20, ranks: [1, 3, 3] }, // 1位1・2位0
    ]);
    const by = Object.fromEntries(r.map((x) => [x.id, x]));
    expect(by.X.dayRank).toBe(1);
    expect(by.Y.dayRank).toBe(2);
  });

  test("完全同着は同順位", () => {
    const r = rankDay([
      { id: "X", total: 20, ranks: [1, 2, 3] },
      { id: "Y", total: 20, ranks: [2, 1, 3] }, // 1位数・2位数・3位数すべて同じ
    ]);
    expect(r[0].dayRank).toBe(1);
    expect(r[1].dayRank).toBe(1);
  });
});
