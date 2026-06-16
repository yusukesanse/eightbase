/**
 * 単体テスト: src/lib/mahjongCs.ts
 * CSトーナメントのブラケット生成ロジック
 */
import {
  generatePrelimRound,
  generateNextRound,
  generateSingleFinal,
  collectAdvancers,
  advancersOf,
  chunkTables,
} from "@/lib/mahjongCs";
import type { MahjongCsEntrant, MahjongCsMatch, MahjongLeagueTier } from "@/types";

function entrant(
  id: string,
  rank: number,
  tier: MahjongLeagueTier,
  seed: boolean
): MahjongCsEntrant {
  return { lineUserId: id, displayName: id, rank, tier, seed };
}

/** 各試合の rank を引数の順に 1,2,3,4… で埋めて完了状態にする */
function completeMatch(match: MahjongCsMatch): MahjongCsMatch {
  return {
    ...match,
    status: "completed",
    players: match.players.map((p, i) => ({ ...p, points: 25000, rank: i + 1 })),
  };
}

// 固定rng（決定的）
const seqRng = () => 0.5;

describe("mahjongCs — chunkTables", () => {
  test("8人は4人×2卓", () => {
    const t = chunkTables(Array.from({ length: 8 }, (_, i) => i), 4);
    expect(t).toHaveLength(2);
    expect(t[0]).toHaveLength(4);
    expect(t[1]).toHaveLength(4);
  });
  test("12人は4人×3卓", () => {
    const t = chunkTables(Array.from({ length: 12 }, (_, i) => i), 4);
    expect(t).toHaveLength(3);
    expect(t.every((x) => x.length === 4)).toBe(true);
  });
  test("0人は空", () => {
    expect(chunkTables([], 4)).toHaveLength(0);
  });
});

describe("mahjongCs — 予選生成", () => {
  test("資料の20名構成: M2×4 + M3×12 で予選4卓", () => {
    const entrants: MahjongCsEntrant[] = [
      ...Array.from({ length: 4 }, (_, i) => entrant(`m1_${i}`, i + 1, "M1", true)),
      ...Array.from({ length: 4 }, (_, i) => entrant(`m2_${i}`, i + 5, "M2", false)),
      ...Array.from({ length: 12 }, (_, i) => entrant(`m3_${i}`, i + 9, "M3", false)),
    ];
    const prelim = generatePrelimRound(entrants, seqRng);
    expect(prelim).not.toBeNull();
    expect(prelim!.matches).toHaveLength(4); // 16人 ÷ 4
    expect(prelim!.advanceCount).toBe(1);
    // 非シードのみ（16人）が予選に入る
    const total = prelim!.matches.flatMap((m) => m.players).length;
    expect(total).toBe(16);
  });

  test("非シードが0人なら予選なし", () => {
    const entrants = Array.from({ length: 4 }, (_, i) => entrant(`m1_${i}`, i + 1, "M1", true));
    expect(generatePrelimRound(entrants, seqRng)).toBeNull();
  });
});

describe("mahjongCs — ラウンド進行", () => {
  test("予選→準決: 予選通過者＋シードで卓を構成し上位2名通過", () => {
    const entrants: MahjongCsEntrant[] = [
      ...Array.from({ length: 4 }, (_, i) => entrant(`m1_${i}`, i + 1, "M1", true)),
      ...Array.from({ length: 4 }, (_, i) => entrant(`m2_${i}`, i + 5, "M2", false)),
      ...Array.from({ length: 12 }, (_, i) => entrant(`m3_${i}`, i + 9, "M3", false)),
    ];
    const seeds = entrants.filter((e) => e.seed);
    let prelim = generatePrelimRound(entrants, seqRng)!;
    prelim = { ...prelim, matches: prelim.matches.map(completeMatch) };

    // 予選通過 = 4卓 × 1名 = 4名
    expect(collectAdvancers(prelim)).toHaveLength(4);

    const semi = generateNextRound(prelim, seeds, seqRng)!;
    expect(semi.type).toBe("semi");
    expect(semi.advanceCount).toBe(2);
    // 準決の人数 = 予選通過4 + シード4 = 8名 → 2卓
    const semiTotal = semi.matches.flatMap((m) => m.players).length;
    expect(semiTotal).toBe(8);
    expect(semi.matches).toHaveLength(2);
  });

  test("準決→決勝: 通過者で1卓、advanceCount=1", () => {
    const entrants: MahjongCsEntrant[] = [
      ...Array.from({ length: 4 }, (_, i) => entrant(`m1_${i}`, i + 1, "M1", true)),
      ...Array.from({ length: 4 }, (_, i) => entrant(`m2_${i}`, i + 5, "M2", false)),
      ...Array.from({ length: 12 }, (_, i) => entrant(`m3_${i}`, i + 9, "M3", false)),
    ];
    const seeds = entrants.filter((e) => e.seed);
    let prelim = generatePrelimRound(entrants, seqRng)!;
    prelim = { ...prelim, matches: prelim.matches.map(completeMatch) };
    let semi = generateNextRound(prelim, seeds, seqRng)!;
    semi = { ...semi, matches: semi.matches.map(completeMatch) };

    // 準決通過 = 2卓 × 2名 = 4名
    expect(collectAdvancers(semi)).toHaveLength(4);

    const final = generateNextRound(semi, [], seqRng)!;
    expect(final.type).toBe("final");
    expect(final.matches).toHaveLength(1);
    expect(final.matches[0].players).toHaveLength(4);
  });

  test("決勝の次はない", () => {
    const final = generateSingleFinal([
      entrant("a", 1, "M1", true),
      entrant("b", 2, "M1", true),
    ]);
    const completed = { ...final, matches: final.matches.map(completeMatch) };
    expect(generateNextRound(completed, [], seqRng)).toBeNull();
  });

  test("4人以下なら一発決勝", () => {
    const final = generateSingleFinal([
      entrant("a", 1, "M1", true),
      entrant("b", 2, "M2", false),
      entrant("c", 3, "M3", false),
    ]);
    expect(final.type).toBe("final");
    expect(final.matches[0].players).toHaveLength(3);
  });

  test("advancersOf は rank 昇順で上位を返す", () => {
    const match: MahjongCsMatch = {
      matchId: "x",
      label: "予選A",
      status: "completed",
      players: [
        { lineUserId: "p1", displayName: "p1", points: 10000, rank: 4 },
        { lineUserId: "p2", displayName: "p2", points: 40000, rank: 1 },
        { lineUserId: "p3", displayName: "p3", points: 25000, rank: 2 },
        { lineUserId: "p4", displayName: "p4", points: 25000, rank: 3 },
      ],
    };
    expect(advancersOf(match, 1).map((p) => p.lineUserId)).toEqual(["p2"]);
    expect(advancersOf(match, 2).map((p) => p.lineUserId)).toEqual(["p2", "p3"]);
  });
});
