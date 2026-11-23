jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/adminAuth", () => ({ checkAdminAuth: jest.fn().mockResolvedValue("admin@example.com") }));
jest.mock("@/lib/mahjong", () => ({ getActiveSeason: jest.fn() }));
jest.mock("@/lib/auditLog", () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/env", () => ({ isProduction: jest.fn().mockReturnValue(false) }));
jest.mock("firebase-admin/firestore", () => {
  const deleteSentinel = Symbol("FieldValue.delete");
  return { FieldValue: { delete: jest.fn(() => deleteSentinel) } };
});

import { GET as LIST, POST as CREATE } from "@/app/api/admin/darts/cs/route";
import { PATCH, DELETE } from "@/app/api/admin/darts/cs/[csEventId]/route";
import { POST as FIX } from "@/app/api/admin/darts/cs/[csEventId]/fix/route";
import { getActiveSeason } from "@/lib/mahjong";
import { getDb } from "@/lib/firebaseAdmin";
import { makeCsDb } from "../../helpers/csDb";
import type { NextRequest } from "next/server";

const body = (b: unknown) => ({ json: async () => b, nextUrl: new URL("http://x/api/admin/darts/cs?seasonId=s1") } as unknown as NextRequest);
const ctx = (csEventId = "cs1") => ({ params: Promise.resolve({ csEventId }) });

function seedScores(db: ReturnType<typeof makeCsDb>) {
  for (let i = 1; i <= 10; i++) db._set("scores", `sc${i}`, { seasonId: "s1", gameCategory: "darts", lineUserId: `u${i}`, totalScore: 1000 - i, displayName: `u${i}` });
}
const createBody = { name: "秋のダーツCS", eventDate: "2099-12-01", capacity: 12,
  entryOpensAt: "2099-11-01T00:00:00+09:00", entryClosesAt: "2099-11-20T00:00:00+09:00" };

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date("2099-11-10T00:00:00Z"));
  (getActiveSeason as jest.Mock).mockResolvedValue({ seasonId: "s1" });
});
afterEach(() => jest.useRealTimers());

test("作成すると dartsCsEvents に入り、優先枠は通算1〜8位", async () => {
  const db = makeCsDb(); seedScores(db); (getDb as jest.Mock).mockReturnValue(db);
  const res = await CREATE(body(createBody));
  expect(res.status).toBe(201);
  const { event } = await res.json();
  expect(db._get("dartsCsEvents", event.csEventId)).toMatchObject({ status: "entry", capacity: 12,
    priorityUserIds: ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8"] });
});

test("定員が優先枠より少ないと作れない（D1・D2 と表示）", async () => {
  const db = makeCsDb(); seedScores(db); (getDb as jest.Mock).mockReturnValue(db);
  const res = await CREATE(body({ ...createBody, capacity: 5 }));
  expect(res.status).toBe(400);
  expect((await res.json()).error).toContain("D1・D2");
});

test("一覧は activeSeasonId と優先枠の人数を返す", async () => {
  const db = makeCsDb(); seedScores(db); (getDb as jest.Mock).mockReturnValue(db);
  const json = await (await LIST(body(null))).json();
  expect(json).toMatchObject({ events: [], activeSeasonId: "s1", priorityPreviewCount: 8 });
});

function seedRunning(db: ReturnType<typeof makeCsDb>) {
  const pl = (id: string) => ({ lineUserId: id, displayName: id, points: null, rank: null });
  db._set("dartsCsEvents", "cs1", {
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

test("結果修正: 境目が同点なら追加スローが無いと 400", async () => {
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
  const final = (db._get("dartsCsEvents", "cs1").rounds as { matches: { players: { lineUserId: string }[] }[] }[])[1].matches[0];
  expect(final.players.map((p) => p.lineUserId).sort()).toEqual(["b", "d", "e"]);
});

test("編成に戻すと closed になり、結果と表彰が消える", async () => {
  const db = makeCsDb(); seedRunning(db); (getDb as jest.Mock).mockReturnValue(db);
  const res = await FIX(body({ action: "resetBracket" }), ctx());
  expect(res.status).toBe(200);
  expect(db._get("dartsCsEvents", "cs1")).toMatchObject({ status: "closed", rounds: [] });
});

test("キャンバスの卓は4名まで（5名は保存も確定もできない）", async () => {
  const db = makeCsDb(); seedRunning(db); (getDb as jest.Mock).mockReturnValue(db);
  db._set("dartsCsEvents", "cs1", { ...db._get("dartsCsEvents", "cs1"), status: "closed", rounds: [] });
  const table = (playerIds: string[]) => ({ tables: [{ id: "F", x: 0, y: 0, advanceCount: 1, to: null, playerIds }] });
  for (const action of ["saveBracket", "confirmBracket"]) {
    const res = await PATCH(body({ action, seedUserIds: [], canvas: table(["a", "b", "c", "d", "e"]) }), ctx());
    expect(res.status).toBe(400);
  }
  expect(db._get("dartsCsEvents", "cs1")).toMatchObject({ status: "closed", rounds: [] });
  // 400 は席数が理由（同じ形の4名卓は保存できる）
  expect((await PATCH(body({ action: "saveBracket", seedUserIds: [], canvas: table(["a", "b", "c", "d"]) }), ctx())).status).toBe(200);
});

test("管理者の参加者追加（addEntry）がダーツの窓口でも動く（段は D3・リーグ未参加でも可）", async () => {
  const db = makeCsDb(); (getDb as jest.Mock).mockReturnValue(db);
  db._set("dartsCsEvents", "cs1", {
    seasonId: "s1", name: "CS", eventDate: "2099-12-01", status: "entry", capacity: 5, priorityUserIds: [],
    entryOpensAt: "2099-11-01T00:00:00+09:00", entryClosesAt: "2099-11-20T00:00:00+09:00",
    entries: [], entrants: [], rounds: [], createdAt: "2099-11-01T00:00:00Z", updatedAt: "",
  });
  db._set("authorizedUsers", "au_x", { lineUserId: "x", active: true, role: "member", displayName: "台帳の名前" });
  db._set("users", "x", { displayName: "追加さん" });
  const res = await PATCH(body({ action: "addEntry", lineUserId: "x" }), ctx());
  expect(res.status).toBe(200);
  expect((db._get("dartsCsEvents", "cs1").entries as Record<string, unknown>[])[0]).toMatchObject({
    lineUserId: "x", displayName: "追加さん", tier: "D3", state: "confirmed" });
});

test("削除できる（旧形式も）", async () => {
  const db = makeCsDb(); (getDb as jest.Mock).mockReturnValue(db);
  db._set("dartsCsEvents", "old", { seasonId: "s1", status: "setup", entrants: [], rounds: [], createdAt: "", updatedAt: "" });
  expect((await DELETE(body(null), ctx("old"))).status).toBe(200);
  expect(db._get("dartsCsEvents", "old")).toBeUndefined();
});

// ---- 修正ラウンド1 ----

const fixP = () => FIX(body({ action: "editMatch", matchId: "P", results: [
  { lineUserId: "a", points: 50 }, { lineUserId: "b", points: 30 }, { lineUserId: "c", points: 10 }] }), ctx());

test("決勝の結果修正で podium と championId が書かれる", async () => {
  const db = makeCsDb(); seedRunning(db); (getDb as jest.Mock).mockReturnValue(db);
  expect((await fixP()).status).toBe(200);
  const res = await FIX(body({ action: "editMatch", matchId: "F", results: [
    { lineUserId: "a", points: 100 }, { lineUserId: "d", points: 50 }, { lineUserId: "e", points: 20 }] }), ctx());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ success: true, championId: "a" });
  expect(db._get("dartsCsEvents", "cs1")).toMatchObject({
    status: "finished", championId: "a", podium: { gold: "a", silver: "d", bronze: "e" } });
});

test("次の卓に申告が入っていると結果修正は 409", async () => {
  const db = makeCsDb(); seedRunning(db); (getDb as jest.Mock).mockReturnValue(db);
  expect((await fixP()).status).toBe(200);
  const cur = db._get("dartsCsEvents", "cs1") as { rounds: { matches: { players: { points: number | null }[] }[] }[] };
  cur.rounds[1].matches[0].players[1].points = 70; // 決勝の d が申告済み
  db._set("dartsCsEvents", "cs1", cur);
  const res = await fixP();
  expect(res.status).toBe(409);
  expect((await res.json()).error).toContain("次の卓に結果が入っている");
});

function seedLegacy(db: ReturnType<typeof makeCsDb>) {
  db._set("dartsCsEvents", "old", {
    seasonId: "s1", name: "旧CS", eventDate: "2099-12-01", status: "finished", entrants: [], championId: "a",
    rounds: [{ type: "final", label: "決勝", advanceCount: 3, matches: [{ matchId: "F", label: "決勝卓", status: "completed",
      players: [{ lineUserId: "a", displayName: "a", points: 100, rank: 1 }] }] }],
    createdAt: "2099-11-01T00:00:00Z", updatedAt: "",
  });
  return structuredClone(db._get("dartsCsEvents", "old"));
}

test("旧形式ダーツへの resetBracket は 409 で doc が変わらない", async () => {
  const db = makeCsDb(); (getDb as jest.Mock).mockReturnValue(db);
  const before = seedLegacy(db);
  const res = await FIX(body({ action: "resetBracket" }), ctx("old"));
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("旧形式のCSは変更できません");
  expect(db._get("dartsCsEvents", "old")).toEqual(before);
});

test("旧形式ダーツへの editMatch は 409 で doc が変わらない", async () => {
  const db = makeCsDb(); (getDb as jest.Mock).mockReturnValue(db);
  const before = seedLegacy(db);
  const res = await FIX(body({ action: "editMatch", matchId: "F", results: [{ lineUserId: "a", points: 10 }] }), ctx("old"));
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("旧形式のCSは変更できません");
  expect(db._get("dartsCsEvents", "old")).toEqual(before);
});

test("旧形式ダーツへの PATCH は 409", async () => {
  const db = makeCsDb(); (getDb as jest.Mock).mockReturnValue(db);
  seedLegacy(db);
  const res = await PATCH(body({ action: "closeNow" }), ctx("old"));
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("旧形式のCSは変更できません");
});
