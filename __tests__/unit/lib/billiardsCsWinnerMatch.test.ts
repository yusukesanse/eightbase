/** ビリヤードCSの申告: 卓の2人が勝った人を申告し、一致したら確定。食い違いは確認待ち（disputed）。純関数。 */
import { claimWinner, settleWinner, winnerPodium, legacyWinRank } from "@/lib/gameCsWinnerMatch";
import type { MahjongCsMatch, MahjongCsRound } from "@/types";

const pl = (id: string) => ({ lineUserId: id, displayName: id, points: null, rank: null });
const match = (over: Partial<MahjongCsMatch> = {}): MahjongCsMatch =>
  ({ matchId: "M", label: "卓", status: "reporting", players: [pl("a"), pl("b")], ...over });
const claim = (m: MahjongCsMatch, who: string, winner: string) => {
  const r = claimWinner(m, who, winner);
  if (!r.ok) throw new Error(r.reason);
  return r.match;
};

test("片方だけの申告では確定しない（相手待ち）", () => {
  const m = claim(match(), "a", "a");
  expect(m.status).toBe("reporting");
  expect(m.claims).toEqual({ a: "a" });
  expect(m.players.every((p) => p.points === null && p.rank === null)).toBe(true);
});

test("2人の申告が一致したら確定。勝者は points 1・rank 1、敗者は points 0・rank 2", () => {
  const m = claim(claim(match(), "a", "b"), "b", "b");
  expect(m.status).toBe("completed");
  expect(m.players).toMatchObject([{ lineUserId: "a", points: 0, rank: 2 }, { lineUserId: "b", points: 1, rank: 1 }]);
});

test("食い違ったら確認待ち（disputed）で、結果は入らない", () => {
  const m = claim(claim(match(), "a", "a"), "b", "b");
  expect(m.status).toBe("disputed");
  expect(m.players.every((p) => p.points === null && p.rank === null)).toBe(true);
});

test("食い違いから片方が出し直して一致すれば、そのまま確定する", () => {
  const disputed = claim(claim(match(), "a", "a"), "b", "b");
  const m = claim(disputed, "b", "a");
  expect(m.status).toBe("completed");
  expect(m.players.find((p) => p.rank === 1)?.lineUserId).toBe("a");
});

test("相手待ちの間は自分の申告を出し直せる", () => {
  const m = claim(claim(match(), "a", "a"), "a", "b");
  expect(m).toMatchObject({ status: "reporting", claims: { a: "b" } });
});

test("確定後は申告できない", () => {
  const done = claim(claim(match(), "a", "a"), "b", "a");
  expect(claimWinner(done, "b", "b")).toEqual({ ok: false, reason: "completed" });
});

test("卓にいない人は申告できず、卓にいない人を勝者にもできない", () => {
  expect(claimWinner(match(), "x", "a")).toEqual({ ok: false, reason: "notInMatch" });
  expect(claimWinner(match(), "a", "x")).toEqual({ ok: false, reason: "badWinner" });
});

test("元の卓は書き換えない", () => {
  const m = match();
  claim(m, "a", "a");
  expect(m.claims).toBeUndefined();
});

test("settleWinner: 管理者の確定。勝者 1/1・敗者 0/2", () => {
  expect(settleWinner([pl("a"), pl("b")], "b")).toMatchObject([{ points: 0, rank: 2 }, { points: 1, rank: 1 }]);
});

const done = (id: string, w: string, l: string) => ({ matchId: id, label: id, status: "completed" as const,
  players: [{ ...pl(w), points: 1, rank: 1 }, { ...pl(l), points: 0, rank: 2 }] });

test("表彰: 決勝の勝者が金・敗者が銀、3位決定戦の勝者が銅", () => {
  const rounds: MahjongCsRound[] = [
    { type: "third", label: "3位決定戦", advanceCount: 1, matches: [done("T", "c", "d")] },
    { type: "final", label: "決勝", advanceCount: 1, matches: [done("F", "a", "b")] },
  ];
  expect(winnerPodium(rounds)).toEqual({ gold: "a", silver: "b", bronze: "c" });
});

test("表彰: 3位決定戦が無ければ銅は null", () => {
  const rounds: MahjongCsRound[] = [{ type: "final", label: "決勝", advanceCount: 1, matches: [done("F", "a", "b")] }];
  expect(winnerPodium(rounds)).toEqual({ gold: "a", silver: "b", bronze: null });
});

test("旧形式の選手: 結果は won にある（rank はリーグのシード順位なので使わない）", () => {
  expect(legacyWinRank({ won: true, rank: 7 })).toBe(1);
  expect(legacyWinRank({ won: false, rank: 1 })).toBe(2);
  expect(legacyWinRank({ won: null, rank: 3 })).toBeNull();
  expect(legacyWinRank({ rank: 3 })).toBeUndefined();
});
