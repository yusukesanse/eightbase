/**
 * 単体テスト: src/lib/pokerCs.ts（CS自動進行エンジン・§5）。
 */
import {
  chunkIntoTables,
  rankByChipsCs,
  evaluatePokerCsMatch,
  buildRoundFromPool,
  advanceCsRound,
  buildInitialPokerCsRounds,
  settleCsRounds,
  isRoundComplete,
  winnerOf,
} from "@/lib/pokerCs";
import type { PokerCsEntrant, PokerCsMatch, PokerCsMatchPlayer, PokerCsRound } from "@/types/poker";

const entrant = (id: string, rank: number, seed = false): PokerCsEntrant => ({
  lineUserId: id,
  displayName: id.toUpperCase(),
  rank,
  seed,
});
const player = (id: string, chips: number | null = null, tb: number | null = null): PokerCsMatchPlayer => ({
  lineUserId: id,
  displayName: id.toUpperCase(),
  chips,
  rank: null,
  tiebreakChips: tb,
});
const match = (players: PokerCsMatchPlayer[], status: PokerCsMatch["status"] = "reporting"): PokerCsMatch => ({
  matchId: "m1",
  label: "予選A",
  players,
  status,
});

describe("chunkIntoTables（2〜4名の均等割り・1人卓を作らない）", () => {
  const sizes = (n: number) => chunkIntoTables(Array.from({ length: n }, (_, i) => i)).map((g) => g.length);
  test("4名=1卓", () => expect(sizes(4)).toEqual([4]));
  test("5名=[3,2]", () => expect(sizes(5)).toEqual([3, 2]));
  test("6名=[3,3]", () => expect(sizes(6)).toEqual([3, 3]));
  test("8名=[4,4]", () => expect(sizes(8)).toEqual([4, 4]));
  test("9名=[3,3,3]", () => expect(sizes(9)).toEqual([3, 3, 3]));
  test("全卓が2〜4名（1人卓なし）", () => {
    for (let n = 5; n <= 20; n++) expect(sizes(n).every((s) => s >= 2 && s <= 4)).toBe(true);
  });
});

describe("rankByChipsCs（終了時チップ＝高いほど上位）", () => {
  test("score 降順で順位付与", () => {
    const r = rankByChipsCs([player("a", 300), player("b", 500), player("c", 400)]);
    const by = Object.fromEntries(r.map((p) => [p.lineUserId, p.rank]));
    expect(by).toEqual({ b: 1, c: 2, a: 3 });
  });
  test("同点は同順位・次は飛ぶ", () => {
    const r = rankByChipsCs([player("a", 500), player("b", 500), player("c", 300)]);
    const by = Object.fromEntries(r.map((p) => [p.lineUserId, p.rank]));
    expect(by).toEqual({ a: 1, b: 1, c: 3 });
  });
  test("同点は tiebreakChips を第2キーに", () => {
    const r = rankByChipsCs([player("a", 500, 20), player("b", 500, 60), player("c", 300)]);
    const by = Object.fromEntries(r.map((p) => [p.lineUserId, p.rank]));
    expect(by).toEqual({ b: 1, a: 2, c: 3 });
  });
});

describe("evaluatePokerCsMatch", () => {
  test("未申告あり=reporting", () => {
    expect(evaluatePokerCsMatch(match([player("a", 500), player("b", null)])).status).toBe("reporting");
  });
  test("1位が一意=completed（rank付与）", () => {
    const r = evaluatePokerCsMatch(match([player("a", 500), player("b", 400), player("c", 300)]));
    expect(r.status).toBe("completed");
    expect(r.players.find((p) => p.lineUserId === "a")?.rank).toBe(1);
  });
  test("1位同点で追加ハンド未入力=tiebreak", () => {
    expect(evaluatePokerCsMatch(match([player("a", 500), player("b", 500), player("c", 300)])).status).toBe("tiebreak");
  });
  test("追加ハンドで決着=completed", () => {
    const r = evaluatePokerCsMatch(match([player("a", 500, 40), player("b", 500, 20), player("c", 300)]));
    expect(r.status).toBe("completed");
    expect(r.players.find((p) => p.lineUserId === "a")?.rank).toBe(1);
  });
  test("追加ハンドもなお同点=tiebreak", () => {
    expect(evaluatePokerCsMatch(match([player("a", 500, 40), player("b", 500, 40), player("c", 300)])).status).toBe("tiebreak");
  });
});

describe("buildInitialPokerCsRounds（シード=上位4予選免除・§5.3）", () => {
  test("2名未満は null", () => {
    expect(buildInitialPokerCsRounds([entrant("a", 1)])).toBeNull();
  });
  test("4名以下は即決勝", () => {
    const rounds = buildInitialPokerCsRounds([entrant("a", 1), entrant("b", 2), entrant("c", 3)])!;
    expect(rounds).toHaveLength(1);
    expect(rounds[0].type).toBe("final");
    expect(rounds[0].matches[0].players).toHaveLength(3);
  });
  test("8名: 上位4はbye(予選免除)・5位以下4名が予選1卓", () => {
    const ents = Array.from({ length: 8 }, (_, i) => entrant(`p${i + 1}`, i + 1));
    const rounds = buildInitialPokerCsRounds(ents)!;
    const r0 = rounds[0];
    expect(r0.type).toBe("prelim");
    expect(r0.byes).toHaveLength(4); // 上位4シード
    expect(r0.byes!.map((b) => b.lineUserId)).toEqual(["p1", "p2", "p3", "p4"]);
    // 予選は5位以下の4名（1卓）
    expect(r0.matches.flatMap((m) => m.players).map((p) => p.lineUserId).sort()).toEqual(["p5", "p6", "p7", "p8"]);
  });
});

/** 完了していない試合を「先頭が最高得点」で埋めて評価する簡易プレイヤ。 */
function playMatch(m: PokerCsMatch): void {
  if (m.status === "completed") return;
  const n = m.players.length;
  m.players = m.players.map((p, i) => ({ ...p, chips: 500 - i * 50 })); // 先頭が最高
  const r = evaluatePokerCsMatch(m);
  m.players = r.players;
  m.status = r.status;
}

describe("フル進行（8名→チャンピオン確定）", () => {
  test("全ラウンドを消化すると決勝で優勝者が決まる", () => {
    const ents = Array.from({ length: 8 }, (_, i) => entrant(`p${i + 1}`, i + 1));
    const rounds = settleCsRounds(buildInitialPokerCsRounds(ents)!);
    let champion: string | null = null;
    let guard = 0;
    while (guard++ < 20) {
      const last = rounds[rounds.length - 1];
      last.matches.forEach(playMatch);
      if (!isRoundComplete(last)) break; // 追加ハンド待ち等（このシナリオでは起きない）
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
  test("合計≤4は決勝（byes+pool を1卓）", () => {
    const r = buildRoundFromPool([player("a"), player("b")], [player("s1")]) as PokerCsRound;
    expect(r.type).toBe("final");
    expect(r.matches[0].players).toHaveLength(3);
  });
  test("1名プールはbye昇格して次を卓む", () => {
    // pool=1, byes=4 → 合計5。lone を bye化して 5名で本戦（[3,2]）。
    const r = buildRoundFromPool([player("x")], Array.from({ length: 4 }, (_, i) => player(`s${i}`))) as PokerCsRound;
    expect(r.matches.every((m) => m.players.length >= 2)).toBe(true);
  });
});
