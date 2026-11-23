/** ビリヤードのCS窓口（管理）: 作成・一覧・編成・結果確定・参加者追加・削除が共通の本体で動く。 */
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/adminAuth", () => ({ checkAdminAuth: jest.fn().mockResolvedValue("admin@example.com") }));
jest.mock("@/lib/mahjong", () => ({ getActiveSeason: jest.fn() }));
jest.mock("@/lib/auditLog", () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/env", () => ({ isProduction: jest.fn().mockReturnValue(false) }));
jest.mock("firebase-admin/firestore", () => {
  const deleteSentinel = Symbol("FieldValue.delete");
  return { FieldValue: { delete: jest.fn(() => deleteSentinel) } };
});

import { GET as LIST, POST as CREATE } from "@/app/api/admin/billiards/cs/route";
import { PATCH, DELETE } from "@/app/api/admin/billiards/cs/[csEventId]/route";
import { POST as FIX } from "@/app/api/admin/billiards/cs/[csEventId]/fix/route";
import { getActiveSeason } from "@/lib/mahjong";
import { getDb } from "@/lib/firebaseAdmin";
import { makeCsDb } from "../../helpers/csDb";
import type { NextRequest } from "next/server";

const body = (b: unknown) => ({ json: async () => b, nextUrl: new URL("http://x/api/admin/billiards/cs?seasonId=s1") } as unknown as NextRequest);
const ctx = (csEventId = "cs1") => ({ params: Promise.resolve({ csEventId }) });

function seedScores(db: ReturnType<typeof makeCsDb>) {
  for (let i = 1; i <= 10; i++) db._set("scores", `sc${i}`, { seasonId: "s1", gameCategory: "billiards", lineUserId: `u${i}`, totalScore: 1000 - i, displayName: `u${i}` });
}
const createBody = { name: "秋のビリヤードCS", eventDate: "2099-12-01", capacity: 12,
  entryOpensAt: "2099-11-01T00:00:00+09:00", entryClosesAt: "2099-11-20T00:00:00+09:00" };

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date("2099-11-10T00:00:00Z"));
  (getActiveSeason as jest.Mock).mockResolvedValue({ seasonId: "s1" });
});
afterEach(() => jest.useRealTimers());

test("作成すると billiardsCsEvents に入り、優先枠は通算1〜8位（B1・B2）", async () => {
  const db = makeCsDb(); seedScores(db); (getDb as jest.Mock).mockReturnValue(db);
  const res = await CREATE(body(createBody));
  expect(res.status).toBe(201);
  const { event } = await res.json();
  expect(db._get("billiardsCsEvents", event.csEventId)).toMatchObject({ status: "entry", capacity: 12,
    priorityUserIds: ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8"] });
});

test("作成後に順位が変わっても優先枠は動かない", async () => {
  const db = makeCsDb(); seedScores(db); (getDb as jest.Mock).mockReturnValue(db);
  const { event } = await (await CREATE(body(createBody))).json();
  db._set("scores", "late", { seasonId: "s1", gameCategory: "billiards", lineUserId: "u9", totalScore: 99999, displayName: "u9" });
  await LIST(body(null));
  expect(db._get("billiardsCsEvents", event.csEventId).priorityUserIds).not.toContain("u9");
});

test("定員が優先枠より少ないと作れない（B1・B2 と表示）", async () => {
  const db = makeCsDb(); seedScores(db); (getDb as jest.Mock).mockReturnValue(db);
  const res = await CREATE(body({ ...createBody, capacity: 5 }));
  expect(res.status).toBe(400);
  expect((await res.json()).error).toContain("B1・B2");
});

test("一覧は旧形式（capacity なし）の setup を、開催日を過ぎていても自動で始めない", async () => {
  const db = makeCsDb(); seedScores(db); (getDb as jest.Mock).mockReturnValue(db);
  db._set("billiardsCsEvents", "old", { seasonId: "s1", name: "旧", eventDate: "2000-01-01", status: "setup",
    entrants: [{ lineUserId: "a", displayName: "a", rank: 1, seed: false }, { lineUserId: "b", displayName: "b", rank: 2, seed: false }],
    rounds: [], createdAt: "2026-01-01T00:00:00Z", updatedAt: "" });
  const json = await (await LIST(body(null))).json();
  expect(json).toMatchObject({ activeSeasonId: "s1", priorityPreviewCount: 8 });
  expect(json.events[0]).toMatchObject({ status: "setup", rounds: [] });
  expect(db._get("billiardsCsEvents", "old")).toMatchObject({ status: "setup", rounds: [] });
});

test("旧形式は変更できず（409）、削除はできる", async () => {
  const db = makeCsDb(); (getDb as jest.Mock).mockReturnValue(db);
  db._set("billiardsCsEvents", "old", { seasonId: "s1", status: "setup", entrants: [], rounds: [], createdAt: "", updatedAt: "" });
  expect((await PATCH(body({ action: "closeNow" }), ctx("old"))).status).toBe(409);
  expect((await FIX(body({ action: "resetBracket" }), ctx("old"))).status).toBe(409);
  expect((await DELETE(body(null), ctx("old"))).status).toBe(200);
  expect(db._get("billiardsCsEvents", "old")).toBeUndefined();
});

function seedClosed(db: ReturnType<typeof makeCsDb>) {
  const ids = ["a", "b", "c", "d"];
  db._set("billiardsCsEvents", "cs1", {
    seasonId: "s1", name: "CS", eventDate: "2099-12-01", status: "closed", capacity: 4, priorityUserIds: [],
    entryOpensAt: "2099-11-01T00:00:00+09:00", entryClosesAt: "2099-11-02T00:00:00+09:00",
    entries: ids.map((id, i) => ({ lineUserId: id, displayName: id, tier: "B3", rank: i + 1, enteredAt: `2099-11-01T00:00:0${i}Z`, state: "confirmed" })),
    entrants: ids.map((id, i) => ({ lineUserId: id, displayName: id, rank: i + 1, seed: false })),
    rounds: [], createdAt: "2099-11-01T00:00:00Z", updatedAt: "",
  });
}
const tb = (id: string, playerIds: string[], to: string | null, loserTo?: string, x = 0) =>
  ({ id, x, y: 0, advanceCount: 1, to, ...(loserTo ? { loserTo } : {}), playerIds });
const four = { tables: [tb("S1", ["a", "b"], "F", "T", 0), tb("S2", ["c", "d"], "F", "T", 1), tb("F", [], null), tb("T", [], null)] };

test("3席の卓は確定できない", async () => {
  const db = makeCsDb(); seedClosed(db); (getDb as jest.Mock).mockReturnValue(db);
  const res = await PATCH(body({ action: "confirmBracket", seedUserIds: [], canvas: { tables: [tb("F", ["a", "b", "c"], null)] } }), ctx());
  expect(res.status).toBe(400);
  expect(db._get("billiardsCsEvents", "cs1").status).toBe("closed");
});

test("編成を確定 → 管理者が勝者を選んで確定 → 終了まで通る（窓口が共通の本体につながっている）", async () => {
  const db = makeCsDb(); seedClosed(db); (getDb as jest.Mock).mockReturnValue(db);
  expect((await PATCH(body({ action: "confirmBracket", seedUserIds: [], canvas: four }), ctx())).status).toBe(200);
  for (const [matchId, winnerId] of [["S1", "a"], ["S2", "d"], ["T", "b"], ["F", "d"]]) {
    expect((await FIX(body({ action: "editMatch", matchId, winnerId }), ctx())).status).toBe(200);
  }
  expect(db._get("billiardsCsEvents", "cs1")).toMatchObject({ status: "finished", championId: "d",
    podium: { gold: "d", silver: "a", bronze: "b" } });
});

test("管理者の参加者追加（addEntry）がビリヤードの窓口でも動く（段は B3・リーグ未参加でも可）", async () => {
  const db = makeCsDb(); (getDb as jest.Mock).mockReturnValue(db);
  db._set("billiardsCsEvents", "cs1", {
    seasonId: "s1", name: "CS", eventDate: "2099-12-01", status: "entry", capacity: 5, priorityUserIds: [],
    entryOpensAt: "2099-11-01T00:00:00+09:00", entryClosesAt: "2099-11-20T00:00:00+09:00",
    entries: [], entrants: [], rounds: [], createdAt: "2099-11-01T00:00:00Z", updatedAt: "",
  });
  db._set("authorizedUsers", "au_x", { lineUserId: "x", active: true, role: "member", displayName: "台帳の名前" });
  db._set("users", "x", { displayName: "追加さん" });
  expect((await PATCH(body({ action: "addEntry", lineUserId: "x" }), ctx())).status).toBe(200);
  expect((db._get("billiardsCsEvents", "cs1").entries as Record<string, unknown>[])[0]).toMatchObject({
    lineUserId: "x", displayName: "追加さん", tier: "B3", state: "confirmed" });
});
