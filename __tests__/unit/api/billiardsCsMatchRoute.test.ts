/**
 * PATCH /api/billiards/cs/match（勝った人の自己申告）の回帰テスト。
 * 卓の2人の申告が一致したら確定し、勝者は次の卓へ・敗者は3位決定戦へ。食い違いは確認待ち。
 */
jest.mock("@/lib/auth", () => ({ requireGameUser: jest.fn() }));
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/env", () => ({ isProduction: jest.fn().mockReturnValue(false) }));

import { PATCH } from "@/app/api/billiards/cs/match/route";
import { requireGameUser } from "@/lib/auth";
import { isProduction } from "@/lib/env";
import { getDb } from "@/lib/firebaseAdmin";
import { toPublicCs } from "@/lib/gameCs/publicCs";
import { BILLIARDS_CS_RULES, DARTS_CS_RULES } from "@/lib/gameCsRules";
import { makeCsDb } from "../../helpers/csDb";
import type { MahjongCsEvent } from "@/types";
import type { NextRequest } from "next/server";

const send = (uid: string, b: Record<string, unknown>) => {
  (requireGameUser as jest.Mock).mockResolvedValue(uid);
  return PATCH({ json: async () => ({ csEventId: "cs1", ...b }) } as unknown as NextRequest);
};
const pl = (id: string) => ({ lineUserId: id, displayName: id, points: null, rank: null });
const seat = (id: string) => ({ kind: "player", lineUserId: id });
const ticket = (fromMatchId: string, place: number) => ({ kind: "ticket", fromMatchId, place });
const m = (matchId: string, players: string[], seats: unknown[]) =>
  ({ matchId, label: `${matchId}卓`, status: "reporting", advanceCount: 1, players: players.map(pl), seats });

/** 準決勝 S1(a,b)・S2(c,d) → 3位決定戦 T → 決勝 F */
function seed(db: ReturnType<typeof makeCsDb>, over: Record<string, unknown> = {}) {
  db._set("billiardsCsEvents", "cs1", {
    seasonId: "s1", name: "CS", eventDate: "2099-12-01", status: "running", capacity: 4, priorityUserIds: [], entries: [],
    entrants: ["a", "b", "c", "d"].map((id, i) => ({ lineUserId: id, displayName: id, rank: i + 1, seed: false })),
    rounds: [
      { type: "prelim", label: "準決勝", advanceCount: 1, matches: [
        m("S1", ["a", "b"], [seat("a"), seat("b")]), m("S2", ["c", "d"], [seat("c"), seat("d")])] },
      { type: "third", label: "3位決定戦", advanceCount: 1, matches: [m("T", [], [ticket("S1", 2), ticket("S2", 2)])] },
      { type: "final", label: "決勝", advanceCount: 1, matches: [m("F", [], [ticket("S1", 1), ticket("S2", 1)])] },
    ],
    createdAt: "", updatedAt: "", ...over,
  });
}
type M = { matchId: string; status: string; claims?: Record<string, string>; players: { lineUserId: string; points: number | null; rank: number | null }[] };
const ev = (db: ReturnType<typeof makeCsDb>) => db._get("billiardsCsEvents", "cs1") as unknown as MahjongCsEvent;
const match = (db: ReturnType<typeof makeCsDb>, id: string) =>
  ev(db).rounds.flatMap((r) => r.matches as unknown as M[]).find((x) => x.matchId === id)!;
const agree = async (matchId: string, p1: string, p2: string, winnerId: string) => {
  await send(p1, { matchId, winnerId });
  return send(p2, { matchId, winnerId });
};

beforeEach(() => (isProduction as jest.Mock).mockReturnValue(false));

test("卓の2人以外は申告できない（403）", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  const res = await send("c", { matchId: "S1", winnerId: "a" });
  expect(res.status).toBe(403);
  expect(match(db, "S1").claims).toBeUndefined();
});

test("2人そろっていない卓（札の席が空き）は 409", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  await agree("S1", "a", "b", "a");
  expect((await send("a", { matchId: "F", winnerId: "a" })).status).toBe(409);
});

test("勝者は卓の2人のどちらかだけ（それ以外は 400）", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  expect((await send("a", { matchId: "S1", winnerId: "c" })).status).toBe(400);
  expect((await send("a", { matchId: "S1" })).status).toBe(400);
});

test("片方だけの申告では確定しない", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  const res = await send("a", { matchId: "S1", winnerId: "a" });
  expect(await res.json()).toEqual({ success: true, status: "reporting", eventStatus: "running" });
  expect(match(db, "S1")).toMatchObject({ status: "reporting", claims: { a: "a" } });
  expect(match(db, "F").players).toEqual([]);
});

test("2人の申告が一致したら確定し、勝者が決勝へ・敗者が3位決定戦へ入る", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  const res = await agree("S1", "a", "b", "b");
  expect((await res.json()).status).toBe("completed");
  expect(match(db, "S1").players).toMatchObject([{ lineUserId: "a", points: 0, rank: 2 }, { lineUserId: "b", points: 1, rank: 1 }]);
  expect(match(db, "F").players.map((p) => p.lineUserId)).toEqual(["b"]);
  expect(match(db, "T").players.map((p) => p.lineUserId)).toEqual(["a"]);
});

test("食い違うと確認待ち（disputed）で卓が止まり、片方が出し直して一致すれば確定する", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  await send("a", { matchId: "S1", winnerId: "a" });
  const res = await send("b", { matchId: "S1", winnerId: "b" });
  expect((await res.json()).status).toBe("disputed");
  expect(match(db, "S1").status).toBe("disputed");
  expect(match(db, "F").players).toEqual([]);
  expect((await (await send("b", { matchId: "S1", winnerId: "a" })).json()).status).toBe("completed");
  expect(match(db, "F").players.map((p) => p.lineUserId)).toEqual(["a"]);
});

test("確定後は申告できない（409）", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  await agree("S1", "a", "b", "a");
  const res = await send("b", { matchId: "S1", winnerId: "b" });
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("この卓は確定済みです");
});

test("画面からは相手の ID を知らずに winner: me / opponent で送れる", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  await send("a", { matchId: "S1", winner: "opponent" });
  expect(match(db, "S1").claims).toEqual({ a: "b" });
  await send("b", { matchId: "S1", winner: "me" });
  expect(match(db, "S1").status).toBe("completed");
  expect(match(db, "F").players.map((p) => p.lineUserId)).toEqual(["b"]);
});

test("決勝が先に確定しても終わらず、3位決定戦の確定で finished。金銀は決勝、銅は3位決定戦の勝者", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  await agree("S1", "a", "b", "a");
  await agree("S2", "c", "d", "d");
  expect((await (await agree("F", "a", "d", "d")).json()).eventStatus).toBe("running");
  expect(ev(db).podium).toBeUndefined();
  const res = await agree("T", "b", "c", "c");
  expect(await res.json()).toEqual({ success: true, status: "completed", eventStatus: "finished" });
  expect(ev(db)).toMatchObject({ status: "finished", championId: "d", podium: { gold: "d", silver: "a", bronze: "c" } });
});

test("3位決定戦が無いCSは、決勝の確定で finished・銅は null", async () => {
  const db = makeCsDb(); (getDb as jest.Mock).mockReturnValue(db);
  seed(db, { rounds: [{ type: "final", label: "決勝", advanceCount: 1, matches: [m("F", ["a", "b"], [seat("a"), seat("b")])] }] });
  await agree("F", "a", "b", "b");
  expect(ev(db)).toMatchObject({ status: "finished", championId: "b", podium: { gold: "b", silver: "a", bronze: null } });
});

test("終了後は申告できない・旧形式には申告できない（409）", async () => {
  const db = makeCsDb(); (getDb as jest.Mock).mockReturnValue(db);
  seed(db, { status: "finished" });
  expect((await send("a", { matchId: "S1", winnerId: "a" })).status).toBe(409);
  seed(db, { capacity: undefined });
  const res = await send("a", { matchId: "S1", winnerId: "a" });
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("旧形式のCSには申告できません");
});

test("expectedStatus が今の卓の状態と違えば 409 で保存しない", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  await send("a", { matchId: "S1", winnerId: "a" });
  await send("b", { matchId: "S1", winnerId: "b" });
  const res = await send("a", { matchId: "S1", winnerId: "b", expectedStatus: "reporting" });
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("卓の状態が変わりました。画面を更新してください");
  expect(match(db, "S1").claims).toEqual({ a: "a", b: "b" });
});

test("デモの自動進行（auto）はデモCSの本番以外だけ。席順の先頭を勝者にして確定する", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  expect((await send("x", { matchId: "S1", auto: true })).status).toBe(403);
  seed(db, { demoDummy: true });
  expect((await send("x", { matchId: "S1", auto: true })).status).toBe(200);
  expect(match(db, "F").players.map((p) => p.lineUserId)).toEqual(["a"]);
  (isProduction as jest.Mock).mockReturnValue(true);
  expect((await send("x", { matchId: "S2", auto: true })).status).toBe(403);
});

describe("公開DTO（lineUserId は出さない）", () => {
  const pub = (db: ReturnType<typeof makeCsDb>, uid: string) =>
    toPublicCs({ ...ev(db), csEventId: "cs1" }, uid, BILLIARDS_CS_RULES);
  const pubMatch = (db: ReturnType<typeof makeCsDb>, uid: string, id: string) =>
    pub(db, uid).rounds.flatMap((r) => r.matches).find((x) => x.matchId === id)! as unknown as
      { status: string; myClaim?: string | null; pendingSeats: string[]; players: { claimed?: boolean; isMe: boolean }[] };

  test("自分の申告（me / opponent）と、各自が申告済みかを返す。相手が誰を勝者にしたかは返さない", async () => {
    const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
    await send("a", { matchId: "S1", winnerId: "b" });
    expect(pubMatch(db, "a", "S1")).toMatchObject({ status: "reporting", myClaim: "opponent",
      players: [{ isMe: true, claimed: true }, { isMe: false, claimed: false }] });
    expect(pubMatch(db, "b", "S1")).toMatchObject({ myClaim: null, players: [{ claimed: true }, { claimed: false }] });
    expect(JSON.stringify(pub(db, "b"))).not.toContain("claims");
  });

  test("食い違いは disputed のまま返す", async () => {
    const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
    await send("a", { matchId: "S1", winnerId: "a" });
    await send("b", { matchId: "S1", winnerId: "b" });
    expect(pubMatch(db, "b", "S1")).toMatchObject({ status: "disputed", myClaim: "me" });
  });

  test("空いている札の席は「勝者／敗者」で呼ぶ", () => {
    const db = makeCsDb(); seed(db);
    expect(pubMatch(db, "a", "F").pendingSeats).toEqual(["S1卓 勝者", "S2卓 勝者"]);
    expect(pubMatch(db, "a", "T").pendingSeats).toEqual(["S1卓 敗者", "S2卓 敗者"]);
  });

  test("点数を申告する種目の応答には myClaim・claimed を足さない", () => {
    const db = makeCsDb(); seed(db);
    const darts = toPublicCs({ ...ev(db), csEventId: "cs1" }, "a", DARTS_CS_RULES);
    const first = darts.rounds[0].matches[0];
    expect("myClaim" in first).toBe(false);
    expect("claimed" in first.players[0]).toBe(false);
    expect(darts.rounds[1].matches[0].pendingSeats).toEqual(["S1卓 2位", "S2卓 2位"]);
  });

  test("旧形式（capacity なし）: 結果は won から、表彰は championId・runnerUpId・thirdId から読む", () => {
    const legacy = {
      csEventId: "old", seasonId: "s1", name: "旧CS", eventDate: "2099-01-01", status: "finished",
      entrants: ["a", "b", "c"].map((id, i) => ({ lineUserId: id, displayName: id, rank: i + 1, seed: false })),
      rounds: [{ type: "final", label: "決勝", matches: [{ matchId: "F", label: "決勝", status: "completed",
        players: [{ lineUserId: "a", displayName: "a", won: false, rank: 1 }, { lineUserId: "b", displayName: "b", won: true, rank: 7 }] }] }],
      championId: "b", runnerUpId: "a", thirdId: "c", createdAt: "", updatedAt: "",
    } as unknown as MahjongCsEvent;
    const dto = toPublicCs(legacy, "a", BILLIARDS_CS_RULES);
    expect(dto.rounds[0].matches[0].players.map((p) => p.rank)).toEqual([2, 1]);
    expect(dto.podium).toMatchObject({ gold: { displayName: "b" }, silver: { displayName: "a" }, bronze: { displayName: "c" } });
  });
});
