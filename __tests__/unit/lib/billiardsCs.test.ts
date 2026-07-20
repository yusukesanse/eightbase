import {
  byeCountFor,
  buildInitialBilliardsCsRounds,
  advanceCsRound,
  settleCsRounds,
  resolvePodium,
  isRoundComplete,
} from "@/lib/billiardsCs";
import type { BilliardsCsEntrant, BilliardsCsRound } from "@/types/billiards";

function entrants(n: number): BilliardsCsEntrant[] {
  return Array.from({ length: n }, (_, i) => ({
    lineUserId: `u${i + 1}`,
    displayName: `P${i + 1}`,
    rank: i + 1, // 1=最上位シード
    seed: i < 4,
  }));
}

/** 指定 matchId の勝者を lineUserId で確定し、必要なら次ラウンドへ進める（report route の純粋版）。 */
function reportWinner(rounds: BilliardsCsRound[], matchId: string, winnerId: string): BilliardsCsRound[] {
  let ri = -1, mi = -1;
  for (let i = 0; i < rounds.length; i++) {
    const j = rounds[i].matches.findIndex((m) => m.matchId === matchId);
    if (j >= 0) { ri = i; mi = j; break; }
  }
  if (ri < 0) throw new Error(`match ${matchId} not found`);
  const round = rounds[ri];
  const match = round.matches[mi];
  match.players = match.players.map((p) => ({ ...p, won: p.lineUserId === winnerId }));
  match.status = "completed";
  if (isRoundComplete(round) && ri === rounds.length - 1 && round.type !== "final") {
    const next = advanceCsRound(round, rounds.length + 1);
    if (next) { rounds.push(next); settleCsRounds(rounds); }
  }
  return rounds;
}

describe("byeCountFor", () => {
  it.each([
    [2, 0], [3, 1], [4, 0], [5, 3], [6, 2], [7, 1], [8, 0], [1, 0],
  ])("n=%i → byes=%i", (n, expected) => {
    expect(byeCountFor(n)).toBe(expected);
  });
});

describe("buildInitialBilliardsCsRounds", () => {
  it("2名未満は null", () => {
    expect(buildInitialBilliardsCsRounds(entrants(1))).toBeNull();
    expect(buildInitialBilliardsCsRounds([])).toBeNull();
  });

  it("2名 → 決勝1試合・byeなし", () => {
    const rounds = buildInitialBilliardsCsRounds(entrants(2))!;
    expect(rounds).toHaveLength(1);
    expect(rounds[0].type).toBe("final");
    expect(rounds[0].matches).toHaveLength(1);
    expect(rounds[0].byes).toHaveLength(0);
  });

  it("3名 → 準決勝1試合＋不戦勝1名（最上位シード）", () => {
    const rounds = buildInitialBilliardsCsRounds(entrants(3))!;
    expect(rounds[0].type).toBe("semi");
    expect(rounds[0].matches).toHaveLength(1);
    expect(rounds[0].byes).toHaveLength(1);
    expect(rounds[0].byes![0].lineUserId).toBe("u1"); // rank1 が不戦勝
    // 対戦は 2位 vs 3位
    const ids = rounds[0].matches[0].players.map((p) => p.lineUserId).sort();
    expect(ids).toEqual(["u2", "u3"]);
  });

  it("4名 → 準決勝2試合・byeなし・上位×下位ペア", () => {
    const rounds = buildInitialBilliardsCsRounds(entrants(4))!;
    expect(rounds[0].type).toBe("semi");
    expect(rounds[0].matches).toHaveLength(2);
    const pair0 = rounds[0].matches[0].players.map((p) => p.lineUserId).sort();
    const pair1 = rounds[0].matches[1].players.map((p) => p.lineUserId).sort();
    expect(pair0).toEqual(["u1", "u4"]);
    expect(pair1).toEqual(["u2", "u3"]);
  });
});

describe("トーナメント進行（4名）", () => {
  it("準決勝→決勝＋3位決定戦→表彰（金銀銅）", () => {
    let rounds = buildInitialBilliardsCsRounds(entrants(4))!;
    // 準決勝: u1 と u2 が勝ち上がる
    const semi = rounds[0];
    rounds = reportWinner(rounds, semi.matches[0].matchId, "u1"); // u1 vs u4 → u1
    rounds = reportWinner(rounds, semi.matches[1].matchId, "u2"); // u2 vs u3 → u2

    // 決勝ラウンドが生成され、3位決定戦を含む
    const final = rounds[rounds.length - 1];
    expect(final.type).toBe("final");
    expect(final.matches.map((m) => m.label)).toEqual(expect.arrayContaining(["決勝", "3位決定戦"]));

    // 決勝未完了では表彰は出ない
    expect(resolvePodium(rounds)).toBeNull();

    const finalMatch = final.matches.find((m) => m.label === "決勝")!;
    const thirdMatch = final.matches.find((m) => m.label === "3位決定戦")!;
    rounds = reportWinner(rounds, finalMatch.matchId, "u1"); // 優勝 u1・準優勝 u2
    rounds = reportWinner(rounds, thirdMatch.matchId, "u4"); // 3位 u4

    const podium = resolvePodium(rounds)!;
    expect(podium.championId).toBe("u1");
    expect(podium.runnerUpId).toBe("u2");
    expect(podium.thirdId).toBe("u4");
  });
});

describe("トーナメント進行（3名）", () => {
  it("不戦勝→決勝。3位決定戦は無し（準決勝敗者1名）", () => {
    let rounds = buildInitialBilliardsCsRounds(entrants(3))!;
    const semi = rounds[0];
    // u2 vs u3 → u2 勝ち。u1 は不戦勝。
    rounds = reportWinner(rounds, semi.matches[0].matchId, "u2");
    const final = rounds[rounds.length - 1];
    expect(final.type).toBe("final");
    expect(final.matches.map((m) => m.label)).not.toContain("3位決定戦");
    // 決勝は u1(bye) vs u2(勝者)
    const ids = final.matches[0].players.map((p) => p.lineUserId).sort();
    expect(ids).toEqual(["u1", "u2"]);

    rounds = reportWinner(rounds, final.matches[0].matchId, "u1");
    const podium = resolvePodium(rounds)!;
    expect(podium.championId).toBe("u1");
    expect(podium.runnerUpId).toBe("u2");
    expect(podium.thirdId).toBeNull();
  });
});
