/**
 * 単体テスト: src/lib/dartsCs.ts（CS自動進行エンジン・§5）。
 */
import {
  chunkIntoGroups,
  rankByScore,
  evaluateCsMatch,
  buildRoundFromPool,
  advanceCsRound,
  buildInitialDartsCsRounds,
  settleCsRounds,
  isRoundComplete,
  winnerOf,
} from "@/lib/dartsCs";
import type { DartsCsEntrant, DartsCsMatch, DartsCsMatchPlayer, DartsCsRound } from "@/types/darts";

const entrant = (id: string, rank: number, seed = false): DartsCsEntrant => ({
  lineUserId: id,
  displayName: id.toUpperCase(),
  rank,
  seed,
});
const player = (id: string, score: number | null = null, tb: number | null = null): DartsCsMatchPlayer => ({
  lineUserId: id,
  displayName: id.toUpperCase(),
  score,
  rank: null,
  tiebreakScore: tb,
});
const match = (players: DartsCsMatchPlayer[], status: DartsCsMatch["status"] = "reporting"): DartsCsMatch => ({
  matchId: "m1",
  label: "予選A",
  players,
  status,
});

describe("chunkIntoGroups（2〜4名の均等割り・1人組を作らない）", () => {
  const sizes = (n: number) => chunkIntoGroups(Array.from({ length: n }, (_, i) => i)).map((g) => g.length);
  test("4名=1組", () => expect(sizes(4)).toEqual([4]));
  test("5名=[3,2]", () => expect(sizes(5)).toEqual([3, 2]));
  test("6名=[3,3]", () => expect(sizes(6)).toEqual([3, 3]));
  test("8名=[4,4]", () => expect(sizes(8)).toEqual([4, 4]));
  test("9名=[3,3,3]", () => expect(sizes(9)).toEqual([3, 3, 3]));
  test("全組が2〜4名（1人組なし）", () => {
    for (let n = 5; n <= 20; n++) expect(sizes(n).every((s) => s >= 2 && s <= 4)).toBe(true);
  });
});

describe("rankByScore（カウントアップ＝高いほど上位）", () => {
  test("score 降順で順位付与", () => {
    const r = rankByScore([player("a", 300), player("b", 500), player("c", 400)]);
    const by = Object.fromEntries(r.map((p) => [p.lineUserId, p.rank]));
    expect(by).toEqual({ b: 1, c: 2, a: 3 });
  });
  test("同点は同順位・次は飛ぶ", () => {
    const r = rankByScore([player("a", 500), player("b", 500), player("c", 300)]);
    const by = Object.fromEntries(r.map((p) => [p.lineUserId, p.rank]));
    expect(by).toEqual({ a: 1, b: 1, c: 3 });
  });
  test("同点は tiebreakScore を第2キーに", () => {
    const r = rankByScore([player("a", 500, 20), player("b", 500, 60), player("c", 300)]);
    const by = Object.fromEntries(r.map((p) => [p.lineUserId, p.rank]));
    expect(by).toEqual({ b: 1, a: 2, c: 3 });
  });
});

describe("evaluateCsMatch", () => {
  test("未申告あり=reporting", () => {
    expect(evaluateCsMatch(match([player("a", 500), player("b", null)])).status).toBe("reporting");
  });
  test("1位が一意=completed（rank付与）", () => {
    const r = evaluateCsMatch(match([player("a", 500), player("b", 400), player("c", 300)]));
    expect(r.status).toBe("completed");
    expect(r.players.find((p) => p.lineUserId === "a")?.rank).toBe(1);
  });
  test("1位同点で追加スロー未入力=tiebreak", () => {
    expect(evaluateCsMatch(match([player("a", 500), player("b", 500), player("c", 300)])).status).toBe("tiebreak");
  });
  test("追加スローで決着=completed", () => {
    const r = evaluateCsMatch(match([player("a", 500, 40), player("b", 500, 20), player("c", 300)]));
    expect(r.status).toBe("completed");
    expect(r.players.find((p) => p.lineUserId === "a")?.rank).toBe(1);
  });
  test("追加スローもなお同点=tiebreak", () => {
    expect(evaluateCsMatch(match([player("a", 500, 40), player("b", 500, 40), player("c", 300)])).status).toBe("tiebreak");
  });
});

describe("buildInitialDartsCsRounds（シード=上位4予選免除・§5.3）", () => {
  test("2名未満は null", () => {
    expect(buildInitialDartsCsRounds([entrant("a", 1)])).toBeNull();
  });
  test("4名以下は即決勝", () => {
    const rounds = buildInitialDartsCsRounds([entrant("a", 1), entrant("b", 2), entrant("c", 3)])!;
    expect(rounds).toHaveLength(1);
    expect(rounds[0].type).toBe("final");
    expect(rounds[0].matches[0].players).toHaveLength(3);
  });
  test("8名: 上位4はbye(予選免除)・5位以下4名が予選1組", () => {
    const ents = Array.from({ length: 8 }, (_, i) => entrant(`p${i + 1}`, i + 1));
    const rounds = buildInitialDartsCsRounds(ents)!;
    const r0 = rounds[0];
    expect(r0.type).toBe("prelim");
    expect(r0.byes).toHaveLength(4); // 上位4シード
    expect(r0.byes!.map((b) => b.lineUserId)).toEqual(["p1", "p2", "p3", "p4"]);
    // 予選は5位以下の4名（1組）
    expect(r0.matches.flatMap((m) => m.players).map((p) => p.lineUserId).sort()).toEqual(["p5", "p6", "p7", "p8"]);
  });
});

/** 完了していない試合を「先頭が最高得点」で埋めて評価する簡易プレイヤ。 */
function playMatch(m: DartsCsMatch): void {
  if (m.status === "completed") return;
  const n = m.players.length;
  m.players = m.players.map((p, i) => ({ ...p, score: 500 - i * 50 })); // 先頭が最高
  const r = evaluateCsMatch(m);
  m.players = r.players;
  m.status = r.status;
}

describe("フル進行（8名→チャンピオン確定）", () => {
  test("全ラウンドを消化すると決勝で優勝者が決まる", () => {
    const ents = Array.from({ length: 8 }, (_, i) => entrant(`p${i + 1}`, i + 1));
    const rounds = settleCsRounds(buildInitialDartsCsRounds(ents)!);
    let champion: string | null = null;
    let guard = 0;
    while (guard++ < 20) {
      const last = rounds[rounds.length - 1];
      last.matches.forEach(playMatch);
      if (!isRoundComplete(last)) break; // 追加スロー待ち等（このシナリオでは起きない）
      if (last.type === "final") {
        champion = winnerOf(last.matches[0])?.lineUserId ?? null;
        break;
      }
      const next = advanceCsRound(last);
      if (!next) break;
      rounds.push(next);
      settleCsRounds(rounds);
    }
    expect(champion).not.toBeNull();
    expect(rounds[rounds.length - 1].type).toBe("final");
  });
});

describe("buildRoundFromPool（bye合流・決勝縮退）", () => {
  test("合計≤4は決勝（byes+pool を1組）", () => {
    const r = buildRoundFromPool([player("a"), player("b")], [player("s1")]) as DartsCsRound;
    expect(r.type).toBe("final");
    expect(r.matches[0].players).toHaveLength(3);
  });
  test("1名プールはbye昇格して次を組む", () => {
    // pool=1, byes=4 → 合計5。lone を bye化して 5名で本戦（[3,2]）。
    const r = buildRoundFromPool([player("x")], Array.from({ length: 4 }, (_, i) => player(`s${i}`))) as DartsCsRound;
    expect(r.matches.every((m) => m.players.length >= 2)).toBe(true);
  });
});
