import {
  ticketLabel, unplacedEntrantIds, validateBracket, buildRunningRounds, applyCompletedMatch,
} from "@/lib/mahjongCsBracket";
import type { MahjongCsEntrant, MahjongCsRound, MahjongCsSeat } from "@/types";

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
