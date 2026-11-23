/**
 * 編成の保存・確定（共通の本体）で、敗者の矢印（loserTo）を扱えるのはビリヤードだけ。
 * 保存時に捨てない・参加者を外しても消えない・他種目では受け付けない。
 */
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/adminAuth", () => ({ checkAdminAuth: jest.fn().mockResolvedValue("admin@example.com") }));
jest.mock("@/lib/mahjong", () => ({ getActiveSeason: jest.fn() }));
jest.mock("@/lib/auditLog", () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/env", () => ({ isProduction: jest.fn().mockReturnValue(false) }));

import { handleAdminCsPatch } from "@/lib/gameCs/admin";
import { BILLIARDS_CS_RULES, DARTS_CS_RULES, type GameCsRules } from "@/lib/gameCsRules";
import { getDb } from "@/lib/firebaseAdmin";
import { makeCsDb } from "../../helpers/csDb";
import type { NextRequest } from "next/server";

const ids = ["a1", "a2", "b1", "b2", "c1", "c2", "d1", "d2"];
const patch = (b: unknown, rules: GameCsRules = BILLIARDS_CS_RULES) => handleAdminCsPatch(
  { json: async () => b } as unknown as NextRequest, { params: Promise.resolve({ csEventId: "cs1" }) }, rules);

function seedClosed(db: ReturnType<typeof makeCsDb>, collection: string) {
  db._set(collection, "cs1", {
    seasonId: "s1", name: "CS", eventDate: "2099-12-01", status: "closed", capacity: 8, priorityUserIds: [],
    entryOpensAt: "2099-11-01T00:00:00+09:00", entryClosesAt: "2099-11-02T00:00:00+09:00",
    entries: ids.map((id, i) => ({ lineUserId: id, displayName: id, tier: "B3", rank: i + 1, enteredAt: `2099-11-01T00:00:0${i}Z`, state: "confirmed" })),
    entrants: ids.map((id, i) => ({ lineUserId: id, displayName: id, rank: i + 1, seed: false })),
    rounds: [], createdAt: "2099-11-01T00:00:00Z", updatedAt: "",
  });
}
const tb = (id: string, playerIds: string[], to: string | null, loserTo?: string, x = 0) =>
  ({ id, x, y: 0, advanceCount: 1, to, ...(loserTo ? { loserTo } : {}), playerIds });
const eight = () => ({ tables: [
  tb("A", ["a1", "a2"], "S1", undefined, 0), tb("B", ["b1", "b2"], "S1", undefined, 1),
  tb("C", ["c1", "c2"], "S2", undefined, 2), tb("D", ["d1", "d2"], "S2", undefined, 3),
  tb("S1", [], "F", "T", 0), tb("S2", [], "F", "T", 1), tb("F", [], null), tb("T", [], null),
] });
type Stored = { status: string; bracket: { canvas: { tables: Record<string, unknown>[] } }; rounds: { type: string; label: string }[] };
const stored = (db: ReturnType<typeof makeCsDb>, c = "billiardsCsEvents") => db._get(c, "cs1") as unknown as Stored;

beforeEach(() => { jest.useFakeTimers().setSystemTime(new Date("2099-11-10T00:00:00Z")); });
afterEach(() => jest.useRealTimers());

test("下書き保存で敗者の矢印が残る（矢印の無い卓には loserTo を書かない）", async () => {
  const db = makeCsDb(); seedClosed(db, "billiardsCsEvents"); (getDb as jest.Mock).mockReturnValue(db);
  expect((await patch({ action: "saveBracket", seedUserIds: [], canvas: eight() })).status).toBe(200);
  const tables = stored(db).bracket.canvas.tables;
  expect(tables.find((x) => x.id === "S1")).toMatchObject({ to: "F", loserTo: "T" });
  expect("loserTo" in tables.find((x) => x.id === "A")!).toBe(false);
});

test("参加者を外しても敗者の矢印は消えない", async () => {
  const db = makeCsDb(); seedClosed(db, "billiardsCsEvents"); (getDb as jest.Mock).mockReturnValue(db);
  await patch({ action: "saveBracket", seedUserIds: [], canvas: eight() });
  expect((await patch({ action: "removeEntry", lineUserId: "a1" })).status).toBe(200);
  const tables = stored(db).bracket.canvas.tables;
  expect(tables.find((x) => x.id === "S2")).toMatchObject({ loserTo: "T" });
  expect(tables.find((x) => x.id === "A")).toMatchObject({ playerIds: ["a2"] });
});

test("8名＋3位決定戦を確定すると running。ラウンドは 準々決勝→準決勝→3位決定戦→決勝", async () => {
  const db = makeCsDb(); seedClosed(db, "billiardsCsEvents"); (getDb as jest.Mock).mockReturnValue(db);
  const res = await patch({ action: "confirmBracket", seedUserIds: [], canvas: eight() });
  expect(res.status).toBe(200);
  expect(stored(db).status).toBe("running");
  expect(stored(db).rounds.map((r) => [r.label, r.type])).toEqual([
    ["準々決勝", "prelim"], ["準決勝", "prelim"], ["3位決定戦", "third"], ["決勝", "final"]]);
});

test("ビリヤードで3席の卓は保存も確定もできない", async () => {
  const db = makeCsDb(); seedClosed(db, "billiardsCsEvents"); (getDb as jest.Mock).mockReturnValue(db);
  for (const action of ["saveBracket", "confirmBracket"]) {
    const res = await patch({ action, seedUserIds: [], canvas: { tables: [tb("F", ["a1", "a2", "b1"], null)] } });
    expect(res.status).toBe(400);
  }
  expect(stored(db).status).toBe("closed");
});

test("敗者の矢印の形が不正なら 400", async () => {
  const db = makeCsDb(); seedClosed(db, "billiardsCsEvents"); (getDb as jest.Mock).mockReturnValue(db);
  const canvas = { tables: [{ ...tb("S", ["a1", "a2"], "F"), loserTo: 5 }, tb("F", ["b1"], null)] };
  expect((await patch({ action: "saveBracket", seedUserIds: [], canvas })).status).toBe(400);
});

test("ダーツでは敗者の矢印つきの編成を保存できない（矢印なしは今までどおり保存でき、loserTo は書かれない）", async () => {
  const db = makeCsDb(); seedClosed(db, "dartsCsEvents"); (getDb as jest.Mock).mockReturnValue(db);
  const withLoser = { tables: [tb("S", ["a1", "a2"], "F", "T"), tb("F", ["b1"], null), tb("T", ["b2"], null)] };
  const res = await patch({ action: "saveBracket", seedUserIds: [], canvas: withLoser }, DARTS_CS_RULES);
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("編成の形式が不正です");
  const plain = { tables: [tb("S", ["a1", "a2"], "F"), tb("F", ["b1"], null)] };
  expect((await patch({ action: "saveBracket", seedUserIds: [], canvas: plain }, DARTS_CS_RULES)).status).toBe(200);
  expect(stored(db, "dartsCsEvents").bracket.canvas.tables.some((x) => "loserTo" in x)).toBe(false);
});
