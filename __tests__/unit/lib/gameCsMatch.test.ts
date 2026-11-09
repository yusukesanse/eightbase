import { cutsFor, evaluateScoreMatch, podiumOf, withTiebreak } from "@/lib/gameCsMatch";
import type { MahjongCsMatchPlayer } from "@/types";

const p = (id: string, points: number | null, tiebreakPoints?: number[]): MahjongCsMatchPlayer =>
  ({ lineUserId: id, displayName: id, points, rank: null, ...(tiebreakPoints ? { tiebreakPoints } : {}) });
const ranks = (r: { players: MahjongCsMatchPlayer[] }) => Object.fromEntries(r.players.map((x) => [x.lineUserId, x.rank]));

test("cutsFor: 決勝以外は通過人数、決勝は1・2・3", () => {
  expect(cutsFor(false, 2)).toEqual([2]);
  expect(cutsFor(true, 1)).toEqual([1, 2, 3]);
});

test("未申告がいれば申告待ち", () => {
  expect(evaluateScoreMatch([p("a", 10), p("b", null)], [1]).status).toBe("reporting");
});

test("同点がなければ確定し、高い順に順位", () => {
  const r = evaluateScoreMatch([p("a", 10), p("b", 30), p("c", 20)], [1]);
  expect(r.status).toBe("completed");
  expect(r.players.map((x) => x.lineUserId)).toEqual(["b", "c", "a"]);
  expect(ranks(r)).toEqual({ b: 1, c: 2, a: 3 });
});

test("上位2名通過で1位と2位が同点（通過する人どうし）は追加勝負しない", () => {
  const r = evaluateScoreMatch([p("a", 50), p("b", 50), p("c", 10)], cutsFor(false, 2));
  expect(r.status).toBe("completed");
  expect(ranks(r)).toEqual({ a: 1, b: 1, c: 3 });
});

test("上位2名通過で2位と3位が同点（境目）は追加勝負", () => {
  const r = evaluateScoreMatch([p("a", 90), p("b", 50), p("c", 50), p("d", 10)], cutsFor(false, 2));
  expect(r.status).toBe("tiebreak");
  expect(r.tiebreakIds.sort()).toEqual(["b", "c"]);
  expect(r.tiebreakLevel).toEqual({ b: 1, c: 1 });
});

test("上位2名通過で3位と4位が同点（通過しない人どうし）は追加勝負しない", () => {
  const r = evaluateScoreMatch([p("a", 90), p("b", 80), p("c", 10), p("d", 10)], cutsFor(false, 2));
  expect(r.status).toBe("completed");
  expect(ranks(r)).toEqual({ a: 1, b: 2, c: 3, d: 3 });
});

test("上位1名通過で1位が3人同点なら3人とも追加勝負", () => {
  const r = evaluateScoreMatch([p("a", 50), p("b", 50), p("c", 50), p("d", 10)], cutsFor(false, 1));
  expect(r.tiebreakIds.sort()).toEqual(["a", "b", "c"]);
});

test("追加勝負は全員がそろうまで待つ（先に入れた人だけで決めない）", () => {
  const r = evaluateScoreMatch([p("a", 90), p("b", 50, [7]), p("c", 50), p("d", 10)], cutsFor(false, 2));
  expect(r.status).toBe("tiebreak");
  expect(r.tiebreakIds.sort()).toEqual(["b", "c"]);
});

test("追加勝負で決着すれば確定", () => {
  const r = evaluateScoreMatch([p("a", 90), p("b", 50, [3]), p("c", 50, [7]), p("d", 10)], cutsFor(false, 2));
  expect(r.status).toBe("completed");
  expect(ranks(r)).toEqual({ a: 1, c: 2, b: 3, d: 4 });
});

test("追加勝負でまた同点なら、その人だけ2回目", () => {
  const r = evaluateScoreMatch(
    [p("a", 50, [9]), p("b", 50, [5]), p("c", 50, [5]), p("d", 10)], cutsFor(false, 2));
  // a は1回目で1位に決まり、b と c が 2位/3位の境目で再び同点
  expect(r.status).toBe("tiebreak");
  expect(r.tiebreakIds.sort()).toEqual(["b", "c"]);
  expect(r.tiebreakLevel).toEqual({ b: 2, c: 2 });
  const done = evaluateScoreMatch(
    [p("a", 50, [9]), p("b", 50, [5, 1]), p("c", 50, [5, 4]), p("d", 10)], cutsFor(false, 2));
  expect(ranks(done)).toEqual({ a: 1, c: 2, b: 3, d: 4 });
});

test("決勝は1-2位・2-3位・3-4位のどの境目の同点も追加勝負", () => {
  const cuts = cutsFor(true, 1);
  expect(evaluateScoreMatch([p("a", 50), p("b", 50), p("c", 30), p("d", 10)], cuts).tiebreakIds.sort()).toEqual(["a", "b"]);
  expect(evaluateScoreMatch([p("a", 90), p("b", 50), p("c", 50), p("d", 10)], cuts).tiebreakIds.sort()).toEqual(["b", "c"]);
  expect(evaluateScoreMatch([p("a", 90), p("b", 70), p("c", 10), p("d", 10)], cuts).tiebreakIds.sort()).toEqual(["c", "d"]);
});

test("決勝の4位と5位の同点は追加勝負しない", () => {
  const r = evaluateScoreMatch([p("a", 90), p("b", 70), p("c", 50), p("d", 10), p("e", 10)], cutsFor(true, 1));
  expect(r.status).toBe("completed");
});

test("withTiebreak は指定の回の値を入れ、前の回は残す（入れ直しは上書き）", () => {
  const players = [p("b", 50, [5]), p("c", 50, [5])];
  expect(withTiebreak(players, "b", 2, 1)[0].tiebreakPoints).toEqual([5, 1]);
  expect(withTiebreak(players, "b", 1, 8)[0].tiebreakPoints).toEqual([8]);
});

test("podiumOf は順位から金銀銅。3名未満なら銅は null", () => {
  const r = evaluateScoreMatch([p("a", 10), p("b", 30), p("c", 20)], cutsFor(true, 1));
  expect(podiumOf(r.players)).toEqual({ gold: "b", silver: "c", bronze: "a" });
  const two = evaluateScoreMatch([p("a", 10), p("b", 30)], cutsFor(true, 1));
  expect(podiumOf(two.players)).toEqual({ gold: "b", silver: "a", bronze: null });
});
