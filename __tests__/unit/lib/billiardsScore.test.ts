/**
 * 単体テスト: src/lib/billiardsScore.ts（要件 §3〜§4）。
 */
import { computeBilliardsDay, rankBilliards, type BilliardsMatchInput } from "@/lib/billiardsScore";
import { billiardsTierForRank, BILLIARDS_WINNER_POINTS } from "@/types/billiards";

describe("computeBilliardsDay（勝者14pt・敗者=落とした玉数）", () => {
  test("1試合: 勝者14 / 敗者5", () => {
    const matches: BilliardsMatchInput[] = [{ winnerId: "a", loserId: "b", loserBalls: 5 }];
    const r = computeBilliardsDay(matches, ["a", "b"]);
    const by = Object.fromEntries(r.map((p) => [p.lineUserId, p]));
    expect(by.a).toMatchObject({ points: 14, wins: 1, losses: 0 });
    expect(by.b).toMatchObject({ points: 5, wins: 0, losses: 1 });
    expect(by.a.matches[0]).toMatchObject({ result: "win", points: 14, opponentId: "b" });
    expect(by.b.matches[0]).toMatchObject({ result: "lose", points: 5, opponentId: "a" });
  });

  test("複数試合を累積", () => {
    const matches: BilliardsMatchInput[] = [
      { winnerId: "a", loserId: "b", loserBalls: 3 },
      { winnerId: "a", loserId: "c", loserBalls: 0 },
      { winnerId: "b", loserId: "c", loserBalls: 7 },
    ];
    const by = Object.fromEntries(computeBilliardsDay(matches, ["a", "b", "c"]).map((p) => [p.lineUserId, p]));
    expect(by.a).toMatchObject({ points: 28, wins: 2, losses: 0 }); // 14+14
    expect(by.b).toMatchObject({ points: 14 + 3, wins: 1, losses: 1 }); // 勝ち14 + 負け3
    expect(by.c).toMatchObject({ points: 0 + 7, wins: 0, losses: 2 }); // 負け0 + 負け7
  });

  test("試合ゼロでも参加者は0ptで出る", () => {
    const r = computeBilliardsDay([], ["a", "b"]);
    expect(r).toHaveLength(2);
    expect(r.every((p) => p.points === 0 && p.wins === 0 && p.losses === 0)).toBe(true);
  });

  test("敗者玉数は0未満に落ちない", () => {
    const by = Object.fromEntries(computeBilliardsDay([{ winnerId: "a", loserId: "b", loserBalls: -3 }], ["a", "b"]).map((p) => [p.lineUserId, p]));
    expect(by.b.points).toBe(0);
  });
});

describe("rankBilliards（点→勝利数→対戦数→名前）", () => {
  test("通算点の降順", () => {
    const r = rankBilliards([
      { id: "a", points: 28, wins: 2, games: 2, name: "A" },
      { id: "b", points: 17, wins: 1, games: 2, name: "B" },
      { id: "c", points: 7, wins: 0, games: 2, name: "C" },
    ]);
    expect(r).toEqual([{ id: "a", rank: 1 }, { id: "b", rank: 2 }, { id: "c", rank: 3 }]);
  });

  test("同点は勝利数で決着", () => {
    const r = Object.fromEntries(
      rankBilliards([
        { id: "a", points: 20, wins: 1, games: 3, name: "A" },
        { id: "b", points: 20, wins: 2, games: 3, name: "B" },
      ]).map((x) => [x.id, x.rank])
    );
    expect(r).toEqual({ b: 1, a: 2 });
  });

  test("点・勝利数・対戦数まで同じなら名前順で一意（同順位を作らない）", () => {
    const r = rankBilliards([
      { id: "z", points: 10, wins: 1, games: 2, name: "わたなべ" },
      { id: "a", points: 10, wins: 1, games: 2, name: "あおき" },
    ]);
    expect(r.find((x) => x.id === "a")?.rank).toBe(1);
    expect(r.find((x) => x.id === "z")?.rank).toBe(2);
  });
});

describe("billiardsTierForRank", () => {
  test("B1(1-4)/B2(5-8)/B3(9+)", () => {
    expect(billiardsTierForRank(1)).toBe("B1");
    expect(billiardsTierForRank(4)).toBe("B1");
    expect(billiardsTierForRank(5)).toBe("B2");
    expect(billiardsTierForRank(8)).toBe("B2");
    expect(billiardsTierForRank(9)).toBe("B3");
  });
  test("勝者点は14", () => expect(BILLIARDS_WINNER_POINTS).toBe(14));
});
