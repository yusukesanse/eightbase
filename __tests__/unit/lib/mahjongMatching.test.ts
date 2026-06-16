/**
 * 単体テスト: src/lib/mahjongMatching.ts
 * 卓組みエンジンのテスト
 */
import { generateRound, MAX_SEATS, type MatchPlayer } from "@/lib/mahjongMatching";

function player(
  id: string,
  rank: number,
  gamesPlayedToday = 0,
  lastPlaceLastRound = false
): MatchPlayer {
  return {
    lineUserId: id,
    displayName: id,
    rank,
    gamesPlayedToday,
    lastPlaceLastRound,
  };
}

describe("mahjongMatching — 卓組みエンジン", () => {
  test("4人未満は卓が成立せず全員見学", () => {
    const players = [player("a", 1), player("b", 2), player("c", 3)];
    const res = generateRound(players);
    expect(res.tables).toHaveLength(0);
    expect(res.spectators).toHaveLength(3);
  });

  test("4人ちょうどで1卓・見学者なし", () => {
    const players = [player("a", 1), player("b", 2), player("c", 3), player("d", 4)];
    const res = generateRound(players);
    expect(res.tables).toHaveLength(1);
    expect(res.tables[0].members.map((m) => m.lineUserId)).toEqual(["a", "b", "c", "d"]);
    expect(res.spectators).toHaveLength(0);
  });

  test("8人で2卓・上位から4人ずつ", () => {
    const players = Array.from({ length: 8 }, (_, i) => player(`u${i + 1}`, i + 1));
    const res = generateRound(players);
    expect(res.tables).toHaveLength(2);
    expect(res.tables[0].members.map((m) => m.rank)).toEqual([1, 2, 3, 4]);
    expect(res.tables[1].members.map((m) => m.rank)).toEqual([5, 6, 7, 8]);
    expect(res.spectators).toHaveLength(0);
  });

  test("5〜7人は1卓のみ・残りは見学", () => {
    const players = Array.from({ length: 6 }, (_, i) => player(`u${i + 1}`, i + 1));
    const res = generateRound(players);
    expect(res.tables).toHaveLength(1);
    expect(res.spectators).toHaveLength(2);
  });

  test("着席は最大8人（12人なら4人見学）", () => {
    const players = Array.from({ length: 12 }, (_, i) => player(`u${i + 1}`, i + 1));
    const res = generateRound(players);
    const seated = res.tables.flatMap((t) => t.members);
    expect(seated).toHaveLength(MAX_SEATS);
    expect(res.spectators).toHaveLength(4);
  });

  test("ラウンド1（全員0試合）は順位上位が出場", () => {
    const players = Array.from({ length: 12 }, (_, i) => player(`u${i + 1}`, i + 1));
    const res = generateRound(players);
    const seatedIds = res.tables.flatMap((t) => t.members.map((m) => m.lineUserId));
    // 上位8人が着席
    expect(seatedIds.sort()).toEqual(
      ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8"].sort()
    );
  });

  test("本日試合数が少ない人が優先される", () => {
    // 上位だが既に2試合打った人と、下位だが0試合の人
    const players = [
      player("veteran", 1, 2),
      player("a", 5, 0),
      player("b", 6, 0),
      player("c", 7, 0),
      player("d", 8, 0),
    ];
    const res = generateRound(players);
    // 0試合の4人が出場、2試合のveteranは見学
    expect(res.tables).toHaveLength(1);
    expect(res.spectators.map((s) => s.lineUserId)).toEqual(["veteran"]);
  });

  test("同試合数なら直前最下位が見学に回りやすい", () => {
    // 5人全員1試合。1人だけ直前最下位
    const players = [
      player("lastplace", 1, 1, true),
      player("a", 2, 1, false),
      player("b", 3, 1, false),
      player("c", 4, 1, false),
      player("d", 5, 1, false),
    ];
    const res = generateRound(players);
    expect(res.tables).toHaveLength(1);
    expect(res.spectators.map((s) => s.lineUserId)).toEqual(["lastplace"]);
  });
});
