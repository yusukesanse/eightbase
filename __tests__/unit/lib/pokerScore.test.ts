/**
 * 単体テスト: src/lib/pokerScore.ts（順位・当日集計の純関数）。
 * 要件 docs/games/poker/ポーカー-ルール草案.md §4〜§5。
 */

import { rankByChips, computePokerDay } from "@/lib/pokerScore";

const P = (n: string) => ({ lineUserId: n, displayName: n.toUpperCase() });

describe("rankByChips（チップ降順・同点同順位）", () => {
  test("§5.1 例: 8名・全員異なるチップ", () => {
    const ranks = new Map(
      rankByChips([
        { id: "A", chips: 18500, name: "A" },
        { id: "B", chips: 12000, name: "B" },
        { id: "C", chips: 9800, name: "C" },
        { id: "D", chips: 7200, name: "D" },
        { id: "E", chips: 5000, name: "E" },
        { id: "F", chips: 3100, name: "F" },
        { id: "G", chips: 1500, name: "G" },
        { id: "H", chips: 0, name: "H" },
      ]).map((r) => [r.id, r.rank])
    );
    expect(ranks.get("A")).toBe(1);
    expect(ranks.get("B")).toBe(2);
    expect(ranks.get("H")).toBe(8);
  });

  test("同チップは同順位・その分だけ次順位が飛ぶ（競技順位）", () => {
    const ranks = new Map(
      rankByChips([
        { id: "A", chips: 10000, name: "A" },
        { id: "B", chips: 8000, name: "B" },
        { id: "C", chips: 8000, name: "C" },
        { id: "D", chips: 5000, name: "D" },
      ]).map((r) => [r.id, r.rank])
    );
    expect(ranks.get("A")).toBe(1);
    expect(ranks.get("B")).toBe(2);
    expect(ranks.get("C")).toBe(2);
    expect(ranks.get("D")).toBe(4); // 2位が2人 → 3位は飛ぶ
  });

  test("全員同チップなら全員1位", () => {
    const ranks = rankByChips([
      { id: "A", chips: 10000, name: "A" },
      { id: "B", chips: 10000, name: "B" },
    ]);
    expect(ranks.every((r) => r.rank === 1)).toBe(true);
  });
});

describe("computePokerDay（当日=チップ合計）", () => {
  test("複数試合のチップを合算・試合数を数える", () => {
    const participants = ["a", "b", "c", "d"].map(P);
    // 試合1: d がディーラー（プレイ対象外）。a=15000, b=5000, c=10000
    // 試合2: a がディーラー。b=8000, c=4000, d=18000
    const day = computePokerDay(
      [
        { gameIndex: 1, dealerId: "d", reports: { a: 15000, b: 5000, c: 10000 } },
        { gameIndex: 2, dealerId: "a", reports: { b: 8000, c: 4000, d: 18000 } },
      ],
      participants
    );
    const by = Object.fromEntries(day.map((p) => [p.lineUserId, p]));
    expect(by.a.totalChips).toBe(15000); // 試合1のみ（試合2はディーラー）
    expect(by.a.gamesPlayed).toBe(1);
    expect(by.b.totalChips).toBe(13000); // 5000 + 8000
    expect(by.b.gamesPlayed).toBe(2);
    expect(by.c.totalChips).toBe(14000); // 10000 + 4000
    expect(by.d.totalChips).toBe(18000); // 試合2のみ
    expect(by.d.gamesPlayed).toBe(1);
  });

  test("各試合の rank はその試合のプレイヤー内で算出（ディーラー除外）", () => {
    const day = computePokerDay(
      [{ gameIndex: 1, dealerId: "d", reports: { a: 15000, b: 5000, c: 10000 } }],
      ["a", "b", "c", "d"].map(P)
    );
    const by = Object.fromEntries(day.map((p) => [p.lineUserId, p]));
    expect(by.a.games[0]).toMatchObject({ gameIndex: 1, chips: 15000, rank: 1 });
    expect(by.c.games[0].rank).toBe(2);
    expect(by.b.games[0].rank).toBe(3);
    expect(by.d.games).toHaveLength(0); // ディーラーは無参加
  });

  test("1試合も無ければ全員 0・gamesPlayed=0", () => {
    const day = computePokerDay([], ["a", "b"].map(P));
    expect(day.every((p) => p.totalChips === 0 && p.gamesPlayed === 0)).toBe(true);
  });
});
