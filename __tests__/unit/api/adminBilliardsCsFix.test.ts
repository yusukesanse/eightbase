/**
 * 管理者の結果確定（/fix の editMatch）: ビリヤードは勝者を選ぶ形（winnerId）。
 * 食い違い（disputed）や相手待ち（reporting）の卓を確定できる。次の卓に申告が入っていたら 409。
 */
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/adminAuth", () => ({ checkAdminAuth: jest.fn().mockResolvedValue("admin@example.com") }));
jest.mock("@/lib/auditLog", () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock("firebase-admin/firestore", () => {
  const deleteSentinel = Symbol("FieldValue.delete");
  return { FieldValue: { delete: jest.fn(() => deleteSentinel) } };
});

import { handleAdminCsFix } from "@/lib/gameCs/fix";
import { BILLIARDS_CS_RULES } from "@/lib/gameCsRules";
import { getDb } from "@/lib/firebaseAdmin";
import { makeCsDb } from "../../helpers/csDb";
import type { MahjongCsEvent } from "@/types";
import type { NextRequest } from "next/server";

const fix = (b: unknown) => handleAdminCsFix(
  { json: async () => b } as unknown as NextRequest, { params: Promise.resolve({ csEventId: "cs1" }) }, BILLIARDS_CS_RULES);
const edit = (matchId: string, winnerId: unknown) => fix({ action: "editMatch", matchId, winnerId });
const pl = (id: string) => ({ lineUserId: id, displayName: id, points: null, rank: null });
const seat = (id: string) => ({ kind: "player", lineUserId: id });
const ticket = (fromMatchId: string, place: number) => ({ kind: "ticket", fromMatchId, place });
const m = (matchId: string, players: string[], seats: unknown[], over: Record<string, unknown> = {}) =>
  ({ matchId, label: `${matchId}卓`, status: "reporting", advanceCount: 1, players: players.map(pl), seats, ...over });

function seed(db: ReturnType<typeof makeCsDb>, s1: Record<string, unknown> = {}) {
  db._set("billiardsCsEvents", "cs1", {
    seasonId: "s1", name: "CS", eventDate: "2099-12-01", status: "running", capacity: 4, priorityUserIds: [], entries: [],
    entrants: ["a", "b", "c", "d"].map((id, i) => ({ lineUserId: id, displayName: id, rank: i + 1, seed: false })),
    rounds: [
      { type: "prelim", label: "準決勝", advanceCount: 1, matches: [
        m("S1", ["a", "b"], [seat("a"), seat("b")], s1), m("S2", ["c", "d"], [seat("c"), seat("d")])] },
      { type: "third", label: "3位決定戦", advanceCount: 1, matches: [m("T", [], [ticket("S1", 2), ticket("S2", 2)])] },
      { type: "final", label: "決勝", advanceCount: 1, matches: [m("F", [], [ticket("S1", 1), ticket("S2", 1)])] },
    ],
    createdAt: "", updatedAt: "",
  });
}
const ev = (db: ReturnType<typeof makeCsDb>) => db._get("billiardsCsEvents", "cs1") as unknown as MahjongCsEvent;
const match = (db: ReturnType<typeof makeCsDb>, id: string) => ev(db).rounds.flatMap((r) => r.matches).find((x) => x.matchId === id)!;
const ids = (db: ReturnType<typeof makeCsDb>, id: string) => match(db, id).players.map((p) => p.lineUserId);

test("食い違い（disputed）の卓を管理者が確定すると、勝者が決勝へ・敗者が3位決定戦へ入る", async () => {
  const db = makeCsDb(); seed(db, { status: "disputed", claims: { a: "a", b: "b" } }); (getDb as jest.Mock).mockReturnValue(db);
  const res = await edit("S1", "b");
  expect(res.status).toBe(200);
  expect(match(db, "S1")).toMatchObject({ status: "completed",
    players: [{ lineUserId: "a", points: 0, rank: 2 }, { lineUserId: "b", points: 1, rank: 1 }] });
  // 管理者の確定を正とし、食い違っていた申告は残さない
  expect(match(db, "S1").claims).toBeUndefined();
  expect(ids(db, "F")).toEqual(["b"]);
  expect(ids(db, "T")).toEqual(["a"]);
});

test("片方がいつまでも申告しない卓（reporting）も確定できる", async () => {
  const db = makeCsDb(); seed(db, { claims: { a: "a" } }); (getDb as jest.Mock).mockReturnValue(db);
  expect((await edit("S1", "a")).status).toBe(200);
  expect(match(db, "S1").status).toBe("completed");
});

test("勝者は卓の2人から選ぶ（それ以外・未指定は 400）", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  expect((await edit("S1", "c")).status).toBe(400);
  expect((await edit("S1", undefined)).status).toBe(400);
  expect(match(db, "S1").status).toBe("reporting");
});

test("2人そろっていない卓は確定できない（409）", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  await edit("S1", "a");
  expect((await edit("F", "a")).status).toBe(409);
});

test("確定済みの卓の勝者を入れ替えると、次の卓の席も入れ替わる", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  await edit("S1", "a");
  expect((await edit("S1", "b")).status).toBe(200);
  expect(ids(db, "F")).toEqual(["b"]);
  expect(ids(db, "T")).toEqual(["a"]);
});

test("次の卓に申告が入っていたら修正できない（409）", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  await edit("S1", "a");
  await edit("S2", "c");
  const event = ev(db);
  event.rounds[1].matches[0].claims = { b: "b" }; // 3位決定戦で片方が申告済み
  db._set("billiardsCsEvents", "cs1", event as unknown as Record<string, unknown>);
  const res = await edit("S1", "b");
  expect(res.status).toBe(409);
  expect((await res.json()).error).toContain("次の卓に結果が入っているため修正できません");
});

test("決勝と3位決定戦を確定すると finished。金銀は決勝、銅は3位決定戦の勝者", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  await edit("S1", "a");
  await edit("S2", "c");
  await edit("T", "d");
  expect(ev(db).status).toBe("running");
  const res = await edit("F", "c");
  expect(await res.json()).toEqual({ success: true, championId: "c" });
  expect(ev(db)).toMatchObject({ status: "finished", championId: "c", podium: { gold: "c", silver: "a", bronze: "d" } });
  // 終了後に3位決定戦を直しても、優勝は決勝の勝者のまま
  expect(await (await edit("T", "b")).json()).toEqual({ success: true, championId: "c" });
  expect(ev(db).podium).toEqual({ gold: "c", silver: "a", bronze: "b" });
});

test("旧形式（capacity なし）は変更できない（409）", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  const { capacity: _c, ...legacy } = ev(db) as MahjongCsEvent & { capacity?: number };
  db.__store.get("billiardsCsEvents")!.set("cs1", legacy as unknown as Record<string, unknown>);
  expect((await edit("S1", "a")).status).toBe(409);
  expect((await fix({ action: "resetBracket" })).status).toBe(409);
});

test("編成に戻すと closed になり、結果が消える", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  expect((await fix({ action: "resetBracket" })).status).toBe(200);
  expect(ev(db)).toMatchObject({ status: "closed", rounds: [] });
});
