import {
  ticketLabel, unplacedEntrantIds, validateBracket, buildRunningRounds, applyCompletedMatch,
} from "@/lib/mahjongCsBracket";
import type { MahjongCsEntrant, MahjongCsRound, MahjongCsSeat } from "@/types";
import { canvasToRounds } from "@/lib/mahjongCsCanvas";

const P = (id: string): MahjongCsSeat => ({ kind: "player", lineUserId: id });
const T = (fromMatchId: string, place: number): MahjongCsSeat => ({ kind: "ticket", fromMatchId, place });
const ent = (id: string): MahjongCsEntrant => ({ lineUserId: id, displayName: `名${id}`, rank: 100000, seed: false });
const match = (matchId: string, label: string, seats: MahjongCsSeat[]) =>
  ({ matchId, label, players: [], status: "reporting" as const, seats });

// 予選2卓（各2名通過）→ 決勝1卓（3位まで表彰）。ids: a〜h
function sample(): MahjongCsRound[] {
  return [
    { type: "prelim", label: "予選", advanceCount: 2, matches: [
      match("A", "予選A卓", [P("a"), P("b"), P("c"), P("d")]),
      match("B", "予選B卓", [P("e"), P("f"), P("g"), P("h")]),
    ] },
    { type: "final", label: "決勝", advanceCount: 3, matches: [
      match("F", "決勝卓", [T("A", 1), T("B", 1), T("A", 2), T("B", 2)]),
    ] },
  ];
}
const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];

describe("ticketLabel", () => {
  it("卓のラベル + 順位", () => {
    expect(ticketLabel(sample(), "A", 1)).toBe("予選A卓 1位");
  });
});

describe("unplacedEntrantIds", () => {
  it("どの席にも入っていない参加確定者を返す", () => {
    const r = sample();
    r[0].matches[0].seats![3] = null;
    expect(unplacedEntrantIds(r, ids)).toEqual(["d"]);
  });
});

describe("validateBracket", () => {
  it.each([1e9, Infinity, NaN, 0, 4, 1.5])("卓の勝ち抜け人数 %s は即座に範囲エラーだけを返す", (advanceCount) => {
    const r = sample();
    // 同期ループはJestのタイムアウトで止まらないため、読み取り回数でも制限する。
    let reads = 0;
    Object.defineProperty(r[0].matches[0], "advanceCount", { get: () => {
      if (++reads > 100) throw new Error("勝ち抜け人数の巨大ループ");
      return advanceCount;
    } });
    expect(validateBracket(r, ids)).toEqual(["予選A卓: 勝ち抜け人数は1〜3名にしてください"]);
  });
  it("旧データのラウンド値1e9でも即座に範囲エラーを返す", () => {
    const r = sample();
    let reads = 0;
    Object.defineProperty(r[0], "advanceCount", { get: () => {
      if (++reads > 100) throw new Error("勝ち抜け人数の巨大ループ");
      return 1e9;
    } });
    expect(validateBracket(r, ids)).toEqual([
      "予選A卓: 勝ち抜け人数は1〜3名にしてください",
      "予選B卓: 勝ち抜け人数は1〜3名にしてください",
    ]);
  });
  it("正しい編成はエラーなし", () => {
    expect(validateBracket(sample(), ids)).toEqual([]);
  });
  it("空席があると NG", () => {
    const r = sample(); r[0].matches[0].seats![0] = null;
    expect(validateBracket(r, ids).join()).toContain("空いている席");
  });
  it("未配置の参加者がいると NG", () => {
    const r = sample(); r[0].matches[0].seats![0] = P("zz");
    const errs = validateBracket(r, ids).join();
    expect(errs).toContain("まだ席がない");
    expect(errs).toContain("参加確定者ではない");
  });
  it("同じ人が2回入っていると NG", () => {
    const r = sample(); r[0].matches[1].seats![0] = P("a");
    expect(validateBracket(r, ids).join()).toContain("2回以上");
  });
  it("最初のラウンドに札は置けない", () => {
    const r = sample(); r[0].matches[0].seats![0] = T("B", 1);
    expect(validateBracket(r, ids).join()).toContain("最初のラウンド");
  });
  it("札が勝ち抜け人数を超える順位を指すと NG", () => {
    const r = sample(); r[1].matches[0].seats![3] = T("B", 3);
    expect(validateBracket(r, ids).join()).toContain("勝ち抜け人数");
  });
  it("直前のラウンド以外の卓を指す札は NG", () => {
    const r = sample(); r[1].matches[0].seats![3] = T("F", 1);
    expect(validateBracket(r, ids).join()).toContain("直前のラウンド");
  });
  it("通過枠の札が置かれていないと NG（B卓2位が行き場なし）", () => {
    const r = sample(); r[1].matches[0].seats![3] = P("x");
    expect(validateBracket(r, [...ids, "x"]).join()).toContain("予選B卓 2位");
  });
  it("同じ札を2回置くと NG", () => {
    const r = sample(); r[1].matches[0].seats![3] = T("A", 1);
    expect(validateBracket(r, ids).join()).toContain("2回以上");
  });
  it("最後のラウンドの卓は1つ", () => {
    const r = sample();
    r[1].matches.push(match("G", "決勝B卓", [P("x1"), P("x2"), P("x3"), P("x4")]));
    expect(validateBracket(r, [...ids, "x1", "x2", "x3", "x4"]).join()).toContain("最後のラウンド");
  });
  it("勝ち抜け人数は1〜3", () => {
    const r = sample(); r[0].advanceCount = 4;
    expect(validateBracket(r, ids).join()).toContain("1〜3");
  });
  it("ラウンドが無いと NG", () => {
    expect(validateBracket([], ids).length).toBeGreaterThan(0);
  });
});

describe("buildRunningRounds", () => {
  it("player 席だけ players に入れ、札は空のまま。最後は final", () => {
    const r = buildRunningRounds(sample(), ids.map(ent));
    expect(r[0].matches[0].players.map((p) => p.lineUserId)).toEqual(["a", "b", "c", "d"]);
    expect(r[0].matches[0].players[0]).toMatchObject({ displayName: "名a", points: null, rank: null });
    expect(r[1].matches[0].players).toEqual([]);
    expect(r[1].type).toBe("final");
    expect(r[0].type).toBe("prelim");
  });
});

function complete(rounds: MahjongCsRound[], matchId: string, order: string[]) {
  for (const rd of rounds) for (const m of rd.matches) if (m.matchId === matchId) {
    m.status = "completed";
    m.players = order.map((id, i) => ({ lineUserId: id, displayName: `名${id}`, points: 40000 - i * 10000, rank: i + 1 }));
  }
}

describe("applyCompletedMatch", () => {
  it("卓が確定したら 1〜advanceCount 位を札の席へ入れる（2名通過）", () => {
    const r = buildRunningRounds(sample(), ids.map(ent));
    complete(r, "A", ["c", "a", "b", "d"]);
    const out = applyCompletedMatch(r, "A", ids.map(ent));
    const fin = out.rounds[1].matches[0];
    expect(fin.seats![0]).toMatchObject({ kind: "ticket", fromMatchId: "A", place: 1, lineUserId: "c" });
    expect(fin.seats![2]).toMatchObject({ kind: "ticket", fromMatchId: "A", place: 2, lineUserId: "a" });
    expect(fin.players.map((p) => p.lineUserId).sort()).toEqual(["a", "c"]);
    expect(out.finished).toBe(false);
  });

  it("決勝卓が確定したら finished と優勝者", () => {
    const r = buildRunningRounds(sample(), ids.map(ent));
    complete(r, "A", ["a", "b", "c", "d"]);
    let out = applyCompletedMatch(r, "A", ids.map(ent));
    complete(out.rounds, "B", ["e", "f", "g", "h"]);
    out = applyCompletedMatch(out.rounds, "B", ids.map(ent));
    complete(out.rounds, "F", ["f", "a", "e", "b"]);
    out = applyCompletedMatch(out.rounds, "F", ids.map(ent));
    expect(out.finished).toBe(true);
    expect(out.championId).toBe("f");
  });

  it("結果を直して再適用すると、札の席の人が入れ替わる", () => {
    const r = buildRunningRounds(sample(), ids.map(ent));
    complete(r, "A", ["a", "b", "c", "d"]);
    let out = applyCompletedMatch(r, "A", ids.map(ent));
    complete(out.rounds, "A", ["d", "c", "b", "a"]);
    out = applyCompletedMatch(out.rounds, "A", ids.map(ent));
    expect(out.rounds[1].matches[0].players.map((p) => p.lineUserId).sort()).toEqual(["c", "d"]);
  });

  it("下流の卓に申告が入っていたら DOWNSTREAM_REPORTED を投げる", () => {
    const r = buildRunningRounds(sample(), ids.map(ent));
    complete(r, "A", ["a", "b", "c", "d"]);
    const out = applyCompletedMatch(r, "A", ids.map(ent));
    out.rounds[1].matches[0].players[0].points = 30000;
    expect(() => applyCompletedMatch(out.rounds, "A", ids.map(ent))).toThrow("DOWNSTREAM_REPORTED");
  });

  it("入力の rounds を変更しない", () => {
    const r = buildRunningRounds(sample(), ids.map(ent));
    complete(r, "A", ["a", "b", "c", "d"]);
    const before = JSON.stringify(r);
    applyCompletedMatch(r, "A", ids.map(ent));
    expect(JSON.stringify(r)).toBe(before);
  });
});

describe("結果の再適用", () => {
  it.each([
    [["b", "a", "c", "d"], ["b", "a"]],
    [["b", "c", "a", "d"], ["b", "c"]],
  ])("勝ち抜け者が重なる編集 %j でも座席順に全員残る", (order, expected) => {
    const r = buildRunningRounds(sample(), ids.map(ent));
    complete(r, "A", ["a", "b", "c", "d"]);
    const first = applyCompletedMatch(r, "A", ids.map(ent));
    complete(first.rounds, "A", order);
    const out = applyCompletedMatch(first.rounds, "A", ids.map(ent));
    expect(out.rounds[1].matches[0].players.map((p) => p.lineUserId)).toEqual(expected);
  });
});

it.each([0, 1])("卓IDの重複はラウンド%dでも拒否する", (ri) => {
  const r = sample();
  r[ri].matches[ri === 0 ? 1 : 0].matchId = "A";
  expect(validateBracket(r, ids).join()).toContain("卓IDが重複");
});

it("札の順位が小数ならその卓のラベル付きエラー", () => {
  const r = sample();
  r[1].matches[0].seats![0] = T("A", 1.5);
  expect(validateBracket(r, ids).some((err) => err.includes("決勝卓"))).toBe(true);
});

describe("不正な席", () => {
  it.each([
    { kind: "foo" },
    { kind: "player" },
    { kind: "player", lineUserId: 123 },
    { kind: "ticket", fromMatchId: "A" },
    { kind: "ticket", fromMatchId: 123, place: 1 },
    { kind: "ticket", fromMatchId: "A", place: "1" },
  ])("%j は空席として扱いヘルパーで無視する", (invalid) => {
    const r = sample();
    r[0].matches[0].seats![0] = invalid as unknown as MahjongCsSeat;
    expect(validateBracket(r, ids).join()).toContain("空いている席");
    expect(unplacedEntrantIds(r, ids)).toEqual(["a"]);
    expect(buildRunningRounds(r, ids.map(ent))[0].matches[0].players.map((p) => p.lineUserId))
      .toEqual(["b", "c", "d"]);
  });

  it("不正な下流席から選手を作らない", () => {
    const r = buildRunningRounds(sample(), ids.map(ent));
    r[1].matches[0].seats![1] = { kind: "ticket", fromMatchId: "A", place: "1", lineUserId: "e" } as unknown as MahjongCsSeat;
    r[1].matches[0].seats![3] = { kind: "player", lineUserId: 123 } as unknown as MahjongCsSeat;
    complete(r, "A", ["a", "b", "c", "d"]);
    expect(applyCompletedMatch(r, "A", ids.map(ent)).rounds[1].matches[0].players.map((p) => p.lineUserId))
      .toEqual(["a", "b"]);
  });
});

it("再確定は札の解決済みlineUserIdを削除して白紙から始める", () => {
  const r = sample();
  r[1].matches[0].seats![0] = { kind: "ticket", fromMatchId: "A", place: 1, lineUserId: "a" };
  const before = JSON.stringify(r);
  const out = buildRunningRounds(r, ids.map(ent));
  expect(out[1].matches[0].seats![0]).toEqual({ kind: "ticket", fromMatchId: "A", place: 1 });
  expect(out[1].matches[0].players).toEqual([]);
  expect(JSON.stringify(r)).toBe(before);
});

it.each(["A", "F"])("未完了の卓 %s は適用を拒否する", (matchId) => {
  const r = buildRunningRounds(sample(), ids.map(ent));
  expect(() => applyCompletedMatch(r, matchId, ids.map(ent))).toThrow("MATCH_NOT_COMPLETED");
});

it("予選→準決→決勝の編成が有効で2段階の勝ち上がりが通る", () => {
  const r = sample();
  r[1] = {
    type: "prelim", label: "準決勝", advanceCount: 2,
    matches: [
      match("S1", "準決1卓", [T("A", 1), P("i"), T("B", 2), P("j")]),
      match("S2", "準決2卓", [T("B", 1), P("k"), T("A", 2), P("l")]),
    ],
  };
  r.push({
    type: "final", label: "決勝", advanceCount: 3,
    matches: [match("F", "決勝卓", [T("S1", 1), T("S2", 1), T("S1", 2), T("S2", 2)])],
  });
  const allIds = [...ids, "i", "j", "k", "l"];
  const entrants = allIds.map(ent);
  expect(validateBracket(r, allIds)).toEqual([]);
  let running = buildRunningRounds(r, entrants);
  complete(running, "A", ["a", "b", "c", "d"]);
  running = applyCompletedMatch(running, "A", entrants).rounds;
  complete(running, "B", ["e", "f", "g", "h"]);
  running = applyCompletedMatch(running, "B", entrants).rounds;
  expect(running[1].matches[0].players.map((p) => p.lineUserId)).toEqual(["a", "i", "f", "j"]);
  expect(running[1].matches[1].players.map((p) => p.lineUserId)).toEqual(["e", "k", "b", "l"]);
  complete(running, "S1", ["a", "f", "i", "j"]);
  const semifinal = applyCompletedMatch(running, "S1", entrants);
  expect(semifinal.finished).toBe(false);
  running = semifinal.rounds;
  complete(running, "S2", ["b", "e", "k", "l"]);
  running = applyCompletedMatch(running, "S2", entrants).rounds;
  expect(running[2].matches[0].players.map((p) => p.lineUserId)).toEqual(["a", "b", "f", "e"]);
  complete(running, "F", ["b", "a", "f", "e"]);
  expect(applyCompletedMatch(running, "F", entrants)).toMatchObject({ finished: true, championId: "b" });
});

describe("卓ごとの勝ち抜け人数", () => {
  it("canvasのA卓1名・B卓3名を保持し、B卓の1〜3位を決勝の札席へ入れる", () => {
    const canvas = canvasToRounds([
      { id: "A", x: 0, y: 1, to: "F", advanceCount: 1, playerIds: ids.slice(0, 4) },
      { id: "B", x: 1, y: 1, to: "F", advanceCount: 3, playerIds: ids.slice(4) },
      { id: "F", x: 0, y: 0, to: null, advanceCount: 3, playerIds: [] },
    ]);
    expect(canvas.errors).toEqual([]);
    expect(validateBracket(canvas.rounds, ids)).toEqual([]);
    const entrants = ids.map(ent);
    const running = buildRunningRounds(canvas.rounds, entrants);
    expect(running[0].advanceCount).toBe(1);
    expect(running[0].matches.map((m) => m.advanceCount)).toEqual([1, 3]);
    expect(running[1].matches[0].advanceCount).toBe(3);
    complete(running, "B", ["g", "e", "h", "f"]);
    const out = applyCompletedMatch(running, "B", entrants);
    expect(out.rounds[1].matches[0].seats).toEqual([
      T("A", 1),
      { kind: "ticket", fromMatchId: "B", place: 1, lineUserId: "g" },
      { kind: "ticket", fromMatchId: "B", place: 2, lineUserId: "e" },
      { kind: "ticket", fromMatchId: "B", place: 3, lineUserId: "h" },
    ]);
    expect(out.rounds[1].matches[0].players.map((p) => p.lineUserId)).toEqual(["g", "e", "h"]);
    expect(out.finished).toBe(false);
  });
  const varied = (): MahjongCsRound[] => {
    const r = sample();
    r[0].matches[0].advanceCount = 1;
    r[0].matches[1].advanceCount = 3;
    r[1].matches[0].seats = [T("A", 1), T("B", 1), T("B", 2), T("B", 3)];
    return r;
  };
  it("A卓1名・B卓3名の通過枠をすべて使える", () => {
    expect(validateBracket(varied(), ids)).toEqual([]);
  });
  it("元卓の上限を超える札を拒否し、未使用の枠を検出する", () => {
    const r = varied();
    r[1].matches[0].seats![3] = T("A", 2);
    expect(validateBracket(r, ids)).toEqual([
      "決勝卓: 予選A卓 2位は勝ち抜け人数を超えています",
      "予選B卓 3位の行き先の席がありません",
    ]);
  });
  it.each([0, 4, 1.5])("卓の人数 %s を検証する", (n) => {
    const r = varied(); r[1].matches[0].advanceCount = n;
    expect(validateBracket(r, ids)).toContain("決勝卓: 勝ち抜け人数は1〜3名にしてください");
  });
  it("全卓に設定があればラウンドの値は使用しない", () => {
    const r = varied(); r[0].advanceCount = 0;
    expect(validateBracket(r, ids)).toEqual([]);
  });
  it("卓の設定がない旧データはラウンドの値を使う", () => {
    expect(validateBracket(sample(), ids)).toEqual([]);
    const r = sample(); r[0].advanceCount = 1;
    expect(validateBracket(r, ids).filter((e) => e.includes("超えています"))).toHaveLength(2);
  });
});
