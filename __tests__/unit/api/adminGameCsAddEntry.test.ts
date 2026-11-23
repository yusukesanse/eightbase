/** 管理者が CS に任意の利用者を参加確定として追加する（PATCH action: "addEntry"・種目共通）。定員は守り、締切と参加資格は見ない。 */
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/adminAuth", () => ({ checkAdminAuth: jest.fn().mockResolvedValue("admin@example.com") }));
jest.mock("@/lib/mahjong", () => ({ getActiveSeason: jest.fn() }));
jest.mock("@/lib/auditLog", () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/env", () => ({ isProduction: jest.fn().mockReturnValue(false) }));
jest.mock("firebase-admin/firestore", () => {
  const deleteSentinel = Symbol("FieldValue.delete");
  return { FieldValue: { delete: jest.fn(() => deleteSentinel) } };
});

import { PATCH as MAHJONG_PATCH } from "@/app/api/admin/mahjong/cs/[csEventId]/route";
import { PATCH as POKER_PATCH } from "@/app/api/admin/poker/cs/[csEventId]/route";
import { checkAdminAuth } from "@/lib/adminAuth";
import { writeAuditLog } from "@/lib/auditLog";
import { getDb } from "@/lib/firebaseAdmin";
import { makeCsDb } from "../../helpers/csDb";
import type { MahjongCsEntrant, MahjongCsEntry } from "@/types";
import type { NextRequest } from "next/server";

type Db = ReturnType<typeof makeCsDb>;
const body = (b: unknown) => ({ json: async () => b } as unknown as NextRequest);
const ctx = (csEventId = "cs1") => ({ params: Promise.resolve({ csEventId }) });
const add = (lineUserId: unknown, patch = MAHJONG_PATCH) => patch(body({ action: "addEntry", lineUserId }), ctx());

const entry = (id: string, minute: number, extra: Partial<MahjongCsEntry> = {}): MahjongCsEntry => ({
  lineUserId: id, displayName: id, tier: "M3", rank: 100000,
  enteredAt: `2099-11-01T00:${String(minute).padStart(2, "0")}:00Z`, state: "confirmed", ...extra,
});

/** 受付中・定員5（優先枠なし）・a〜d が確定＝空き1。 */
function seed(db: Db, over: Record<string, unknown> = {}, collection = "mahjongCsEvents") {
  db._set(collection, "cs1", {
    seasonId: "s1", name: "CS", eventDate: "2099-12-01", status: "entry", capacity: 5, priorityUserIds: [],
    entryOpensAt: "2099-11-01T00:00:00+09:00", entryClosesAt: "2099-11-20T00:00:00+09:00",
    entries: [entry("a", 1), entry("b", 2), entry("c", 3), entry("d", 4)],
    entrants: [], rounds: [], createdAt: "2099-11-01T00:00:00Z", updatedAt: "",
    ...over,
  });
  // x: 連携済みの有効な利用者（リーグ未参加）。g: ゲスト。z: 無効化された利用者。w: キャンセル待ちの本人
  db._set("authorizedUsers", "au_x", { lineUserId: "x", active: true, role: "member", displayName: "台帳の名前" });
  db._set("authorizedUsers", "au_g", { lineUserId: "g", active: true, role: "guest" });
  db._set("authorizedUsers", "au_z", { lineUserId: "z", active: false, role: "member" });
  db._set("authorizedUsers", "au_w", { lineUserId: "w", active: true, role: "member" });
  db._set("authorizedUsers", "au_a", { lineUserId: "a", active: true, role: "member" });
  db._set("users", "x", { displayName: "追加さん", pictureUrl: "https://example.com/x.png" });
}
/** 定員4・a〜d で満員、w がキャンセル待ち。 */
const FULL = { capacity: 4, entries: [entry("a", 1), entry("b", 2), entry("c", 3), entry("d", 4), entry("w", 5, { state: "waitlisted" })] };
const useDb = (over?: Record<string, unknown>, collection?: string) => {
  const db = makeCsDb(); seed(db, over, collection); (getDb as jest.Mock).mockReturnValue(db); return db;
};
const entriesOf = (db: Db, collection = "mahjongCsEvents") =>
  db._get(collection, "cs1").entries as MahjongCsEntry[];
const find = (db: Db, id: string, collection?: string) => entriesOf(db, collection).find((e) => e.lineUserId === id);

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date("2099-11-10T00:00:00Z"));
  (checkAdminAuth as jest.Mock).mockResolvedValue("admin@example.com");
  (writeAuditLog as jest.Mock).mockClear();
});
afterEach(() => jest.useRealTimers());

test("管理者でなければ 401", async () => {
  const db = useDb();
  (checkAdminAuth as jest.Mock).mockResolvedValue(null);
  expect((await add("x")).status).toBe(401);
  expect(find(db, "x")).toBeUndefined();
});

test.each([[""], ["   "], [undefined], [123], [null]])("lineUserId が不正（%p）なら 400", async (id) => {
  const db = useDb();
  const res = await add(id);
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("lineUserId が不正です");
  expect(entriesOf(db)).toHaveLength(4);
});

test.each([["z（無効化された利用者）"], ["nobody（存在しない）"]])("%s は 404 で、doc を書かない", async (label) => {
  const db = useDb();
  const before = JSON.stringify(db._get("mahjongCsEvents", "cs1"));
  const res = await add(label.split("（")[0]);
  expect(res.status).toBe(404);
  expect((await res.json()).error).toBe("利用者が見つかりません");
  expect(JSON.stringify(db._get("mahjongCsEvents", "cs1"))).toBe(before);
  expect(writeAuditLog).not.toHaveBeenCalled();
});

test("CS が無ければ 404", async () => {
  useDb();
  const res = await MAHJONG_PATCH(body({ action: "addEntry", lineUserId: "x" }), ctx("none"));
  expect(res.status).toBe(404);
  expect((await res.json()).error).toBe("CSが見つかりません");
});

test.each([["running"], ["finished"]])("%s では 409", async (status) => {
  const db = useDb({ status });
  const res = await add("x");
  expect(res.status).toBe(409);
  expect(find(db, "x")).toBeUndefined();
});

test("受付開始前・リーグ未参加でも、空きがあれば追加でき参加確定になる", async () => {
  const db = useDb({ entryOpensAt: "2099-11-15T00:00:00+09:00" });
  const res = await add("x");
  expect(res.status).toBe(200);
  expect(find(db, "x")).toEqual({
    lineUserId: "x", displayName: "追加さん", pictureUrl: "https://example.com/x.png",
    tier: "M3", rank: 100000, enteredAt: "2099-11-10T00:00:00.000Z", state: "confirmed", adminAdded: true,
  });
  expect(entriesOf(db).map((e) => `${e.lineUserId}:${e.state}`).sort())
    .toEqual(["a:confirmed", "b:confirmed", "c:confirmed", "d:confirmed", "x:confirmed"]);
  expect(db._get("mahjongCsEvents", "cs1").status).toBe("entry");
  expect((await res.json()).event.entries).toHaveLength(5);
});

test("空き1に1人追加したあと、もう1人は 409", async () => {
  const db = useDb();
  expect((await add("x")).status).toBe(200);
  const res = await add("g");
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("定員に達しているため追加できません");
  expect(find(db, "g")).toBeUndefined();
});

test("満員なら 409 で、doc を書かず監査も残さない", async () => {
  const db = useDb(FULL);
  const before = JSON.stringify(db._get("mahjongCsEvents", "cs1"));
  const res = await add("x");
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("定員に達しているため追加できません");
  expect(JSON.stringify(db._get("mahjongCsEvents", "cs1"))).toBe(before);
  expect(writeAuditLog).not.toHaveBeenCalled();
});

test("キャンセル待ちの人は追加できない（空きが無いので 409・状態はそのまま）", async () => {
  const db = useDb(FULL);
  const res = await add("w");
  expect(res.status).toBe(409);
  expect(find(db, "w")).toEqual(entry("w", 5, { state: "waitlisted" }));
});

test("受付中は、未表明の優先枠の席を空きに数えない（優先枠の本人は追加できる）", async () => {
  const db = useDb({ priorityUserIds: ["g"] });
  expect((await add("x")).status).toBe(409);
  expect(find(db, "x")).toBeUndefined();
  expect((await add("g")).status).toBe(200);
  expect(find(db, "g")).toMatchObject({ state: "confirmed", adminAdded: true });
});

test("締切後の満員に優先枠の人を足すと確定者が押し出されるので 409", async () => {
  const db = useDb({ ...FULL, status: "closed", priorityUserIds: ["g"] });
  const before = JSON.stringify(db._get("mahjongCsEvents", "cs1"));
  expect((await add("g")).status).toBe(409);
  expect(JSON.stringify(db._get("mahjongCsEvents", "cs1"))).toBe(before);
});

test("名前・段はサーバーが解決し、クライアントの値は使わない。ゲストも追加できる", async () => {
  const db = useDb();
  const res = await MAHJONG_PATCH(body({ action: "addEntry", lineUserId: "g", displayName: "偽名", tier: "M1", rank: 1 }), ctx());
  expect(res.status).toBe(200);
  expect(find(db, "g")).toMatchObject({ displayName: "ユーザー", tier: "M3", rank: 100000, state: "confirmed", adminAdded: true });
});

test("users に名前が無い人は authorizedUsers の名前で保存する", async () => {
  const db = useDb();
  db._set("authorizedUsers", "au_g", { lineUserId: "g", active: true, role: "guest", displayName: "ゲスト花子" });
  const res = await MAHJONG_PATCH(body({ action: "addEntry", lineUserId: "g" }), ctx());
  expect(res.status).toBe(200);
  expect(find(db, "g")).toMatchObject({ displayName: "ゲスト花子" });
});

test("確定編成に載っている人は、その段と順位で入る", async () => {
  const db = useDb();
  db._set("mahjongLeagueAssignments", "la1", { seasonId: "s1", confirmedAt: "2099-10-01T00:00:00Z",
    entries: [{ lineUserId: "x", tier: "M2", rank: 7 }] });
  expect((await add("x")).status).toBe(200);
  expect(find(db, "x")).toMatchObject({ tier: "M2", rank: 7 });
});

test("closed で追加すると entrants に入り、シードは保たれ、編成（bracket）は触らない", async () => {
  const entrants: MahjongCsEntrant[] = ["a", "b", "c", "d"].map((id, i) =>
    ({ lineUserId: id, displayName: id, tier: "M3", rank: 100000, seed: i === 0 }));
  const bracket = { seedUserIds: ["a"], canvas: { tables: [{ id: "F", x: 0, y: 0, advanceCount: 1, to: null, playerIds: ["a", "b"] }] }, rounds: [] };
  const db = useDb({ status: "closed", closedAt: "2099-11-09T00:00:00Z", entrants, bracket });
  expect((await add("x")).status).toBe(200);
  const event = db._get("mahjongCsEvents", "cs1") as { entrants: MahjongCsEntrant[]; bracket: unknown; status: string };
  expect(event.status).toBe("closed");
  expect(event.entrants.map((e) => `${e.lineUserId}:${e.seed}`).sort())
    .toEqual(["a:true", "b:false", "c:false", "d:false", "x:false"]);
  expect(event.entrants.find((e) => e.lineUserId === "x")).toMatchObject({ displayName: "追加さん", tier: "M3" });
  expect(event.bracket).toEqual(bracket);
});

test("受付の締切時刻を過ぎていたら、締め切ってから追加する（entrants に入る）", async () => {
  const db = useDb({ entryClosesAt: "2099-11-05T00:00:00+09:00" });
  expect((await add("x")).status).toBe(200);
  const event = db._get("mahjongCsEvents", "cs1") as { entrants: MahjongCsEntrant[]; status: string };
  expect(event.status).toBe("closed");
  expect(event.entrants.map((e) => e.lineUserId).sort()).toEqual(["a", "b", "c", "d", "x"]);
  const types = (writeAuditLog as jest.Mock).mock.calls.map(([log]) => log.eventType);
  expect(types).toEqual(expect.arrayContaining(["cs.entryClosed", "cs.entryAdded"]));
});

test("締切時刻を過ぎた満員の CS では 409 だが、締切だけは保存する", async () => {
  const db = useDb({ ...FULL, entryClosesAt: "2099-11-05T00:00:00+09:00" });
  expect((await add("x")).status).toBe(409);
  expect(db._get("mahjongCsEvents", "cs1").status).toBe("closed");
  expect(find(db, "x")).toBeUndefined();
});

test("既に確定の人は 200 で今の状態を返すだけ（印を付けず、doc も監査も書かない）", async () => {
  const db = useDb(FULL);
  const before = JSON.stringify(db._get("mahjongCsEvents", "cs1"));
  const res = await add("a");
  expect(res.status).toBe(200);
  expect((await res.json()).event.entries).toHaveLength(5);
  expect(JSON.stringify(db._get("mahjongCsEvents", "cs1"))).toBe(before);
  expect(writeAuditLog).not.toHaveBeenCalled();
});

test("既に確定の人でも、締切時刻を過ぎていたら締切だけは保存する", async () => {
  const db = useDb({ entryClosesAt: "2099-11-05T00:00:00+09:00" });
  expect((await add("a")).status).toBe(200);
  expect(db._get("mahjongCsEvents", "cs1").status).toBe("closed");
  expect(find(db, "a")).toEqual(entry("a", 1));
  expect((writeAuditLog as jest.Mock).mock.calls.map(([log]) => log.eventType)).toEqual(["cs.entryClosed"]);
});

test("監査ログ cs.entryAdded に実行者・対象・状態が残る", async () => {
  useDb();
  await add("x");
  expect(writeAuditLog).toHaveBeenCalledTimes(1);
  expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
    eventType: "cs.entryAdded", actor: "admin@example.com",
    target: { date: "2099-12-01", lineUserId: "x" },
    meta: { csEventId: "cs1", lineUserId: "x", phase: "entry", before: "none" },
  }));
});

test("ポーカーの窓口でも動く（pokerCsEvents・段は P3）", async () => {
  const db = useDb({}, "pokerCsEvents");
  const res = await add("x", POKER_PATCH);
  expect(res.status).toBe(200);
  expect(find(db, "x", "pokerCsEvents")).toMatchObject({ tier: "P3", rank: 100000, state: "confirmed", adminAdded: true });
});

test("ポーカーで通算順位のある人は、その段と順位で入る", async () => {
  const db = useDb({}, "pokerCsEvents");
  db._set("scores", "sc1", { seasonId: "s1", gameCategory: "poker", lineUserId: "x", totalScore: 900, displayName: "x" });
  expect((await add("x", POKER_PATCH)).status).toBe(200);
  expect(find(db, "x", "pokerCsEvents")).toMatchObject({ tier: "P1", rank: 1 });
});

test("ほかの action では利用者や順位を読まない（読み取りを増やさない）", async () => {
  const db = useDb();
  db.reads.length = 0;
  expect((await MAHJONG_PATCH(body({ action: "removeEntry", lineUserId: "a" }), ctx())).status).toBe(200);
  expect(db.reads).toEqual(["mahjongCsEvents"]);
});
