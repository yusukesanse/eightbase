jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/adminAuth", () => ({ checkAdminAuth: jest.fn().mockResolvedValue("admin@example.com") }));
jest.mock("@/lib/mahjong", () => ({ getActiveSeason: jest.fn() }));
jest.mock("@/lib/auditLog", () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/env", () => ({ isProduction: jest.fn().mockReturnValue(false) }));
jest.mock("firebase-admin/firestore", () => {
  const deleteSentinel = Symbol("FieldValue.delete");
  return { FieldValue: { delete: jest.fn(() => deleteSentinel) } };
});

import { GET as LIST, POST as CREATE } from "@/app/api/admin/poker/cs/route";
import { PATCH, DELETE } from "@/app/api/admin/poker/cs/[csEventId]/route";
import { POST as FIX } from "@/app/api/admin/poker/cs/[csEventId]/fix/route";
import { getActiveSeason } from "@/lib/mahjong";
import { getDb } from "@/lib/firebaseAdmin";
import { makeCsDb } from "../../helpers/csDb";
import type { NextRequest } from "next/server";

const body = (b: unknown) => ({ json: async () => b, nextUrl: new URL("http://x/api/admin/poker/cs?seasonId=s1") } as unknown as NextRequest);
const ctx = (csEventId = "cs1") => ({ params: Promise.resolve({ csEventId }) });

function seedScores(db: ReturnType<typeof makeCsDb>) {
  for (let i = 1; i <= 10; i++) db._set("scores", `sc${i}`, { seasonId: "s1", gameCategory: "poker", lineUserId: `u${i}`, totalScore: 1000 - i, displayName: `u${i}` });
}
const createBody = { name: "秋のポーカーCS", eventDate: "2099-12-01", capacity: 12,
  entryOpensAt: "2099-11-01T00:00:00+09:00", entryClosesAt: "2099-11-20T00:00:00+09:00" };

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date("2099-11-10T00:00:00Z"));
  (getActiveSeason as jest.Mock).mockResolvedValue({ seasonId: "s1" });
});
afterEach(() => jest.useRealTimers());

test("作成すると pokerCsEvents に入り、優先枠は通算1〜8位", async () => {
  const db = makeCsDb(); seedScores(db); (getDb as jest.Mock).mockReturnValue(db);
  const res = await CREATE(body(createBody));
  expect(res.status).toBe(201);
  const { event } = await res.json();
  expect(db._get("pokerCsEvents", event.csEventId)).toMatchObject({ status: "entry", capacity: 12,
    priorityUserIds: ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8"] });
});

test("定員が優先枠より少ないと作れない（P1・P2 と表示）", async () => {
  const db = makeCsDb(); seedScores(db); (getDb as jest.Mock).mockReturnValue(db);
  const res = await CREATE(body({ ...createBody, capacity: 5 }));
  expect(res.status).toBe(400);
  expect((await res.json()).error).toContain("P1・P2");
});

test("一覧は activeSeasonId と優先枠の人数を返す", async () => {
  const db = makeCsDb(); seedScores(db); (getDb as jest.Mock).mockReturnValue(db);
  const json = await (await LIST(body(null))).json();
  expect(json).toMatchObject({ events: [], activeSeasonId: "s1", priorityPreviewCount: 8 });
});

function seedRunning(db: ReturnType<typeof makeCsDb>) {
  const pl = (id: string) => ({ lineUserId: id, displayName: id, points: null, rank: null });
  db._set("pokerCsEvents", "cs1", {
    seasonId: "s1", name: "CS", eventDate: "2099-12-01", status: "running", capacity: 5, priorityUserIds: [],
    entries: [], entrants: ["a", "b", "c", "d", "e"].map((id, i) => ({ lineUserId: id, displayName: id, rank: i + 1, seed: false })),
    rounds: [
      { type: "prelim", label: "準決勝", advanceCount: 1, matches: [{ matchId: "P", label: "準決勝卓", status: "reporting", advanceCount: 1,
        players: ["a", "b", "c"].map(pl), seats: ["a", "b", "c"].map((id) => ({ kind: "player", lineUserId: id })) }] },
      { type: "final", label: "決勝", advanceCount: 3, matches: [{ matchId: "F", label: "決勝卓", status: "reporting", advanceCount: 3,
        players: ["d", "e"].map(pl), seats: [{ kind: "ticket", fromMatchId: "P", place: 1 }, ...["d", "e"].map((id) => ({ kind: "player", lineUserId: id }))] }] },
    ],
    createdAt: "2099-11-01T00:00:00Z", updatedAt: "",
  });
}

test("結果修正: 境目が同点なら追加ハンドが無いと 400", async () => {
  const db = makeCsDb(); seedRunning(db); (getDb as jest.Mock).mockReturnValue(db);
  const res = await FIX(body({ action: "editMatch", matchId: "P", results: [
    { lineUserId: "a", points: 50 }, { lineUserId: "b", points: 50 }, { lineUserId: "c", points: 10 }] }), ctx());
  expect(res.status).toBe(400);
});

test("結果修正: 確定すると1位が決勝の札の席に入る", async () => {
  const db = makeCsDb(); seedRunning(db); (getDb as jest.Mock).mockReturnValue(db);
  const res = await FIX(body({ action: "editMatch", matchId: "P", results: [
    { lineUserId: "a", points: 50, tiebreakPoints: [1] }, { lineUserId: "b", points: 50, tiebreakPoints: [9] }, { lineUserId: "c", points: 10 }] }), ctx());
  expect(res.status).toBe(200);
  const final = (db._get("pokerCsEvents", "cs1").rounds as { matches: { players: { lineUserId: string }[] }[] }[])[1].matches[0];
  expect(final.players.map((p) => p.lineUserId).sort()).toEqual(["b", "d", "e"]);
});

test("編成に戻すと closed になり、結果と表彰が消える", async () => {
  const db = makeCsDb(); seedRunning(db); (getDb as jest.Mock).mockReturnValue(db);
  const res = await FIX(body({ action: "resetBracket" }), ctx());
  expect(res.status).toBe(200);
  expect(db._get("pokerCsEvents", "cs1")).toMatchObject({ status: "closed", rounds: [] });
});

test("キャンバスの卓は6名まで（7名は 400）", async () => {
  const db = makeCsDb(); seedRunning(db); (getDb as jest.Mock).mockReturnValue(db);
  db._set("pokerCsEvents", "cs1", { ...db._get("pokerCsEvents", "cs1"), status: "closed", rounds: [] });
  const canvas = { tables: [{ id: "F", x: 0, y: 0, advanceCount: 1, to: null, playerIds: ["a", "b", "c", "d", "e", "f", "g"] }] };
  const res = await PATCH(body({ action: "saveBracket", seedUserIds: [], canvas }), ctx());
  expect(res.status).toBe(400);
});

test("削除できる（旧形式も）", async () => {
  const db = makeCsDb(); (getDb as jest.Mock).mockReturnValue(db);
  db._set("pokerCsEvents", "old", { seasonId: "s1", status: "setup", entrants: [], rounds: [], createdAt: "", updatedAt: "" });
  expect((await DELETE(body(null), ctx("old"))).status).toBe(200);
  expect(db._get("pokerCsEvents", "old")).toBeUndefined();
});
