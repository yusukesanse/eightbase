/**
 * 単体テスト: src/lib/mahjongCs.ts
 * CSトーナメント: 卓は必ず4名（端数はbye）・1着通過・自動生成/進行。
 */
import {
  advanceCsRound,
  buildInitialCsRounds,
  startCsIfDue,
  groupIntoFours,
  advancersOf,
  chunkTables,
} from "@/lib/mahjongCs";
import type {
  MahjongCsEntrant,
  MahjongCsMatch,
  MahjongCsMatchPlayer,
  MahjongCsRound,
  MahjongLeagueTier,
} from "@/types";

function entrant(id: string, rank: number, tier: MahjongLeagueTier, seed: boolean): MahjongCsEntrant {
  return { lineUserId: id, displayName: id, rank, tier, seed };
}
function player(id: string): MahjongCsMatchPlayer {
  return { lineUserId: id, displayName: id, points: null, rank: null };
}
/** 各試合の rank を並び順に 1..N で埋めて完了にする */
function completeMatch(match: MahjongCsMatch): MahjongCsMatch {
  return { ...match, status: "completed", players: match.players.map((p, i) => ({ ...p, points: 25000, rank: i + 1 })) };
}
/** rank 1..n・上位4名を M1シードにしたエントリー */
const many = (n: number): MahjongCsEntrant[] =>
  Array.from({ length: n }, (_, i) => entrant(`p${i + 1}`, i + 1, i < 4 ? "M1" : "M3", i < 4));
const allFours = (r: MahjongCsRound) => r.matches.every((m) => m.players.length === 4);
const seqRng = () => 0.5;

describe("groupIntoFours — 卓は必ず4名・端数はbye", () => {
  const pl = (n: number) => Array.from({ length: n }, (_, i) => player(`p${i}`));
  it("8名→2卓×4・bye0", () => {
    const { tables, byes } = groupIntoFours(pl(8));
    expect(tables).toHaveLength(2);
    expect(tables.every((t) => t.length === 4)).toBe(true);
    expect(byes).toHaveLength(0);
  });
  it("6名→1卓×4・bye2（先頭＝上位シードがbye）", () => {
    const { tables, byes } = groupIntoFours(pl(6));
    expect(tables).toHaveLength(1);
    expect(tables[0]).toHaveLength(4);
    expect(byes.map((b) => b.lineUserId)).toEqual(["p0", "p1"]);
  });
  it("10名→2卓×4・bye2", () => {
    const { tables, byes } = groupIntoFours(pl(10));
    expect(tables).toHaveLength(2);
    expect(tables.every((t) => t.length === 4)).toBe(true);
    expect(byes).toHaveLength(2);
  });
});

describe("buildInitialCsRounds — 卓は必ず4名", () => {
  it("2名未満は生成不可(null)", () => expect(buildInitialCsRounds(many(1), seqRng)).toBeNull());
  it("4名は決勝（1卓4名）", () => {
    const r = buildInitialCsRounds(many(4), seqRng)!;
    expect(r[0].type).toBe("final");
    expect(r[0].matches[0].players).toHaveLength(4);
  });
  it("16名は4卓すべて4名・byeなし", () => {
    const r = buildInitialCsRounds(many(16), seqRng)!;
    expect(r[0].matches).toHaveLength(4);
    expect(allFours(r[0])).toBe(true);
    expect(r[0].byes ?? []).toHaveLength(0);
  });
  it("6名でも卓は4名（bye2で調整）", () => {
    const r = buildInitialCsRounds(many(6), seqRng)!;
    expect(allFours(r[0])).toBe(true);
    expect(r[0].byes).toHaveLength(2);
  });
});

describe("advanceCsRound — 進行しても卓は必ず4名", () => {
  it("16名: 準決(4卓×4)→決勝(4名)→決勝後はnull", () => {
    const rounds = buildInitialCsRounds(many(16), seqRng)!;
    const cur = { ...rounds[0], matches: rounds[0].matches.map(completeMatch) };
    expect(allFours(cur)).toBe(true);
    const final = advanceCsRound(cur)!;
    expect(final.type).toBe("final");
    expect(final.matches).toHaveLength(1);
    expect(final.matches[0].players).toHaveLength(4);
    const done = { ...final, matches: final.matches.map(completeMatch) };
    expect(advanceCsRound(done)).toBeNull();
  });
});

describe("startCsIfDue", () => {
  const base = { status: "setup", entrants: many(16), rounds: [] as never[] };
  it("確定日が来たら running へ生成（当日=境界）", () => {
    const res = startCsIfDue({ ...base, eventDate: "2026-07-11" }, "2026-07-11", seqRng);
    expect(res?.status).toBe("running");
    expect(allFours(res!.rounds[0])).toBe(true);
  });
  it("確定日前は生成しない(null)", () => {
    expect(startCsIfDue({ ...base, eventDate: "2026-07-18" }, "2026-07-11", seqRng)).toBeNull();
  });
  it("既に開始済みは再生成しない(null)", () => {
    expect(startCsIfDue({ ...base, status: "running", eventDate: "2026-07-11" }, "2026-07-11", seqRng)).toBeNull();
  });
});

describe("補助関数", () => {
  it("chunkTables 8人は4人×2卓", () => {
    const t = chunkTables(Array.from({ length: 8 }, (_, i) => i), 4);
    expect(t).toHaveLength(2);
    expect(t.every((x) => x.length === 4)).toBe(true);
  });
  it("advancersOf は rank 昇順で上位を返す", () => {
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
  });
});
