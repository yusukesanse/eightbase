/**
 * ビリヤードCSの編成: 2人卓・敗者の矢印（3位決定戦）。
 * 敗者の矢印はルール表で許した種目だけ。麻雀・ポーカー・ダーツの検証結果は変えない。
 */
import { afterMatchCompleted, buildRunningRounds, ticketLabel, validateBracket } from "@/lib/mahjongCsBracket";
import {
  canvasToRounds, connectLoser, disconnectLoser, fillEmptySeats, incomingCount, openSeats, removeTable, tableLabels, type CanvasDraft,
} from "@/lib/mahjongCsCanvas";
import { BILLIARDS_CS_RULES as B, DARTS_CS_RULES, MAHJONG_CS_RULES, POKER_CS_RULES } from "@/lib/gameCsRules";
import type { MahjongCsCanvasTable, MahjongCsEntrant, MahjongCsRound } from "@/types";

const t = (id: string, playerIds: string[], to: string | null, loserTo?: string | null, x = 0): MahjongCsCanvasTable =>
  ({ id, x, y: 0, advanceCount: 1, to, ...(loserTo !== undefined ? { loserTo } : {}), playerIds });

/** 8名: 1回戦4卓 → 準決勝2卓 → 決勝。準決勝の敗者は3位決定戦へ */
const eight = (): MahjongCsCanvasTable[] => [
  t("A", ["a1", "a2"], "S1", undefined, 0), t("B", ["b1", "b2"], "S1", undefined, 1),
  t("C", ["c1", "c2"], "S2", undefined, 2), t("D", ["d1", "d2"], "S2", undefined, 3),
  t("S1", [], "F", "T", 0), t("S2", [], "F", "T", 1),
  t("F", [], null), t("T", [], null),
];
const ids8 = ["a1", "a2", "b1", "b2", "c1", "c2", "d1", "d2"];
const entrants = (ids: string[]): MahjongCsEntrant[] => ids.map((id, i) => ({ lineUserId: id, displayName: id, rank: i + 1, seed: false }));

/** 卓 matchId を winner の勝ちで確定して進める */
function win(rounds: MahjongCsRound[], matchId: string, winner: string, ids: string[]) {
  const match = rounds.flatMap((r) => r.matches).find((m) => m.matchId === matchId)!;
  match.players = match.players.map((p) => ({ ...p, points: p.lineUserId === winner ? 1 : 0, rank: p.lineUserId === winner ? 1 : 2 }));
  match.status = "completed";
  return afterMatchCompleted({ entrants: entrants(ids) }, rounds, matchId);
}
const playersOf = (rounds: MahjongCsRound[], matchId: string) =>
  rounds.flatMap((r) => r.matches).find((m) => m.matchId === matchId)!.players.map((p) => p.lineUserId);

describe("敗者の矢印の検証", () => {
  test.each([["麻雀", MAHJONG_CS_RULES], ["ポーカー", POKER_CS_RULES], ["ダーツ", DARTS_CS_RULES]])(
    "%s では敗者の矢印を引けない", (_name, rules) => {
      const { errors } = canvasToRounds([t("S", ["a", "b"], "F", "T"), t("F", ["c"], null), t("T", ["d"], null)], rules);
      expect(errors).toContain("卓(S): 敗者の矢印は使えません");
    });

  test("自分・存在しない卓へは引けない", () => {
    expect(canvasToRounds([t("S", ["a", "b"], "F", "S"), t("F", ["c"], null)], B).errors)
      .toContain("卓(S): 敗者の矢印の先の卓がありません");
    expect(canvasToRounds([t("S", ["a", "b"], "F", "X"), t("F", ["c"], null)], B).errors)
      .toContain("卓(S): 敗者の矢印の先の卓がありません");
  });

  test("勝者と同じ卓へは引けない", () => {
    expect(canvasToRounds([t("S", ["a", "b"], "F", "F"), t("F", ["c"], null)], B).errors)
      .toContain("卓(S): 敗者の矢印は勝者の矢印と別の卓へ引いてください");
  });

  test("矢印が出ていない卓（決勝・3位決定戦）からは引けない", () => {
    expect(canvasToRounds([t("S", ["a", "b"], "F", "T"), t("F", ["c"], null, "T"), t("T", ["d"], null)], B).errors)
      .toContain("卓(F): 矢印が出ていない卓から敗者の矢印は引けません");
  });

  test("行き先は3位決定戦（矢印が出ておらず、勝者の矢印が入らない卓）だけ", () => {
    // S1 の敗者を、勝者の矢印が出ている卓 S2 へ
    const tables = [t("S1", ["a", "b"], "F", "S2"), t("S2", ["c"], "F"), t("F", [], null)];
    expect(canvasToRounds(tables, B).errors).toContain("卓(S1): 敗者の矢印は3位決定戦（矢印が出ていない卓）へ引いてください");
  });
});

describe("終端の卓", () => {
  test("1卓だけの決勝（2名）は確定できる", () => {
    const { rounds, errors } = canvasToRounds([t("F", ["a", "b"], null)], B);
    expect(errors).toEqual([]);
    expect(validateBracket(rounds, ["a", "b"], B)).toEqual([]);
  });

  test("3位決定戦は0か1つ。2つあると確定できない", () => {
    const tables = [...eight(), t("T2", [], null)];
    tables.find((x) => x.id === "S2")!.loserTo = "T2";
    tables.find((x) => x.id === "T")!.playerIds = ["x1"];
    tables.find((x) => x.id === "T2")!.playerIds = ["x2"];
    expect(canvasToRounds(tables, B).errors).toContain("3位決定戦は1つにしてください（今 2 卓）");
  });

  test("決勝が2つあると、今までと同じ文言で確定できない", () => {
    const { errors } = canvasToRounds([t("F1", ["a", "b"], null), t("F2", ["c", "d"], null)], B);
    expect(errors).toEqual(["決勝（矢印が出ていない卓）は1つにしてください（今 2 卓）"]);
  });
});

describe("8名＋3位決定戦", () => {
  test("ラウンドは 準々決勝 → 準決勝 → 3位決定戦 → 決勝。敗者の席は place:2 の札", () => {
    const { rounds, errors } = canvasToRounds(eight(), B);
    expect(errors).toEqual([]);
    expect(rounds.map((r) => [r.label, r.type, r.matches.length])).toEqual([
      ["準々決勝", "prelim", 4], ["準決勝", "prelim", 2], ["3位決定戦", "third", 1], ["決勝", "final", 1],
    ]);
    expect(rounds[2].matches[0]).toMatchObject({ matchId: "T", label: "3位決定戦", seats: [
      { kind: "ticket", fromMatchId: "S1", place: 2 }, { kind: "ticket", fromMatchId: "S2", place: 2 }] });
    expect(rounds[3].matches[0].seats).toEqual([
      { kind: "ticket", fromMatchId: "S1", place: 1 }, { kind: "ticket", fromMatchId: "S2", place: 1 }]);
    expect(validateBracket(rounds, ids8, B)).toEqual([]);
  });

  test("確定しても 3位決定戦のラウンドの種別は third のまま", () => {
    const running = buildRunningRounds(canvasToRounds(eight(), B).rounds, entrants(ids8));
    expect(running.map((r) => r.type)).toEqual(["prelim", "prelim", "third", "final"]);
  });

  test("準決勝の勝者は決勝へ、敗者は3位決定戦へ入る", () => {
    let rounds = buildRunningRounds(canvasToRounds(eight(), B).rounds, entrants(ids8));
    for (const [m, w] of [["A", "a1"], ["B", "b1"], ["C", "c1"], ["D", "d1"]]) rounds = win(rounds, m, w, ids8).rounds;
    expect(playersOf(rounds, "S1")).toEqual(["a1", "b1"]);
    rounds = win(rounds, "S1", "a1", ids8).rounds;
    rounds = win(rounds, "S2", "d1", ids8).rounds;
    expect(playersOf(rounds, "F")).toEqual(["a1", "d1"]);
    expect(playersOf(rounds, "T")).toEqual(["b1", "c1"]);
  });

  test("決勝が先に確定しても、3位決定戦が確定するまで終了しない。優勝は決勝の勝者", () => {
    let rounds = buildRunningRounds(canvasToRounds(eight(), B).rounds, entrants(ids8));
    for (const [m, w] of [["A", "a1"], ["B", "b1"], ["C", "c1"], ["D", "d1"], ["S1", "a1"], ["S2", "d1"]]) rounds = win(rounds, m, w, ids8).rounds;
    const afterFinal = win(rounds, "F", "d1", ids8);
    expect(afterFinal.status).toBe("running");
    expect(afterFinal.championId).toBeUndefined();
    const afterThird = win(afterFinal.rounds, "T", "c1", ids8);
    expect(afterThird).toMatchObject({ status: "finished", championId: "d1" });
  });

  test("3位決定戦が先に確定しても終了せず、決勝の確定で終了する", () => {
    let rounds = buildRunningRounds(canvasToRounds(eight(), B).rounds, entrants(ids8));
    for (const [m, w] of [["A", "a1"], ["B", "b1"], ["C", "c1"], ["D", "d1"], ["S1", "a1"], ["S2", "d1"]]) rounds = win(rounds, m, w, ids8).rounds;
    const afterThird = win(rounds, "T", "b1", ids8);
    expect(afterThird.status).toBe("running");
    expect(win(afterThird.rounds, "F", "a1", ids8)).toMatchObject({ status: "finished", championId: "a1" });
  });

  test("次の卓に勝者の申告（claims）が入っていたら、前の卓は直せない", () => {
    let rounds = buildRunningRounds(canvasToRounds(eight(), B).rounds, entrants(ids8));
    for (const [m, w] of [["A", "a1"], ["B", "b1"], ["C", "c1"], ["D", "d1"], ["S1", "a1"], ["S2", "d1"]]) rounds = win(rounds, m, w, ids8).rounds;
    rounds.flatMap((r) => r.matches).find((m) => m.matchId === "T")!.claims = { b1: "b1" };
    expect(() => win(rounds, "S1", "b1", ids8)).toThrow("DOWNSTREAM_REPORTED");
  });
});

describe("席の検証（ビリヤード）", () => {
  test("3人入る卓は確定できない", () => {
    const { errors } = canvasToRounds([t("S", ["a", "b"], "F"), t("F", ["c", "d"], null)], B);
    expect(errors.join("\n")).toContain("席が足りません（3名入ります）");
  });

  test("敗者の札を2回使うと確定できない", () => {
    const { rounds } = canvasToRounds(eight(), B);
    rounds[3].matches[0].seats = [{ kind: "ticket", fromMatchId: "S1", place: 1 }, { kind: "ticket", fromMatchId: "S1", place: 2 }];
    expect(validateBracket(rounds, ids8, B).join("\n")).toContain("準決勝A卓 2位の札が2回以上置かれています");
  });

  test("麻雀・ポーカー・ダーツでは 2位の札（通過人数より下）は今までどおり弾く", () => {
    const { rounds } = canvasToRounds(eight(), B);
    expect(validateBracket(rounds, ids8, POKER_CS_RULES).join("\n")).toContain("は勝ち抜け人数を超えています");
  });

  test("3位決定戦が無ければ今までと同じ形（準決勝 → 決勝）", () => {
    const tables = eight().filter((x) => x.id !== "T").map((x) => { const { loserTo: _l, ...rest } = x; return rest; });
    const { rounds, errors } = canvasToRounds(tables, B);
    expect(errors).toEqual([]);
    expect(rounds.map((r) => r.label)).toEqual(["準々決勝", "準決勝", "決勝"]);
    expect(validateBracket(rounds, ids8, B)).toEqual([]);
  });
});

describe("キャンバスの操作", () => {
  const draft = (): CanvasDraft => ({ seedUserIds: [], tables: eight() });

  test("敗者の矢印で入る人も「入ってくる人数」に数え、空席を減らす", () => {
    expect(incomingCount(eight(), "T")).toBe(2);
    expect(openSeats(eight(), "T", B.maxSeats)).toBe(0);
  });

  test("未配置の人を空席に入れるとき、敗者の矢印が入る卓には入れない", () => {
    const d = draft();
    for (const table of d.tables) table.playerIds = [];
    const filled = fillEmptySeats(d, ids8, B.maxSeats);
    expect(filled.tables.find((x) => x.id === "T")!.playerIds).toEqual([]);
    expect(filled.tables.find((x) => x.id === "A")!.playerIds).toHaveLength(2);
  });

  test("connectLoser は自分・存在しない卓・勝者と同じ卓へは引かない", () => {
    const d: CanvasDraft = { seedUserIds: [], tables: [t("S", [], "F"), t("F", [], null), t("T", [], null)] };
    expect(connectLoser(d, "S", "S").tables[0].loserTo).toBeUndefined();
    expect(connectLoser(d, "S", "X").tables[0].loserTo).toBeUndefined();
    expect(connectLoser(d, "S", "F").tables[0].loserTo).toBeUndefined();
    expect(connectLoser(d, "S", "T").tables[0].loserTo).toBe("T");
  });

  test("disconnectLoser は敗者の矢印だけを外す（勝者の矢印は残す）", () => {
    const after = disconnectLoser(draft(), "S1").tables.find((x) => x.id === "S1")!;
    expect(after.to).toBe("F");
    expect("loserTo" in after).toBe(false);
  });

  test("卓を消すと、その卓へ向いた敗者の矢印も外れる", () => {
    const after = removeTable(draft(), "T");
    expect(after.tables.some((x) => "loserTo" in x)).toBe(false);
  });

  test("編集途中の名前: 3位決定戦は「3位決定戦」", () => {
    expect(tableLabels(eight(), B).get("T")).toBe("3位決定戦");
  });
});

test("札の呼び名: 勝者を申告する種目は 勝者／敗者", () => {
  const { rounds } = canvasToRounds(eight(), B);
  expect(ticketLabel(rounds, "S1", 1, true)).toBe("準決勝A卓 勝者");
  expect(ticketLabel(rounds, "S1", 2, true)).toBe("準決勝A卓 敗者");
  expect(ticketLabel(rounds, "S1", 1)).toBe("準決勝A卓 1位");
});
