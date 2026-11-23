/** ビリヤードのCS窓口（利用者）: 参加表明・取消・閲覧が共通の本体で動く。旧形式は閲覧だけ。 */
jest.mock("@/lib/auth", () => ({ requireGameUser: jest.fn() }));
jest.mock("@/lib/mahjong", () => ({ getActiveSeason: jest.fn() }));
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/auditLog", () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));

import { POST, DELETE } from "@/app/api/billiards/cs/entry/route";
import { GET } from "@/app/api/billiards/cs/route";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { getDb } from "@/lib/firebaseAdmin";
import { makeCsDb } from "../../helpers/csDb";
import { existsSync } from "fs";
import { join } from "path";
import type { NextRequest } from "next/server";

const req = () => ({ json: async () => ({}) } as unknown as NextRequest);
const asUser = (id: string) => (requireGameUser as jest.Mock).mockResolvedValue(id);

function seed(db: ReturnType<typeof makeCsDb>, over: Record<string, unknown> = {}) {
  db._set("billiardsCsEvents", "cs1", {
    csEventId: "cs1", seasonId: "s1", name: "ビリヤードCS", eventDate: "2099-10-20",
    status: "entry", capacity: 3, priorityUserIds: ["p1"],
    entryOpensAt: "2026-10-01T00:00:00+09:00", entryClosesAt: "2099-01-01T00:00:00+09:00",
    entries: [], entrants: [], rounds: [], createdAt: "2026-10-01T00:00:00Z", updatedAt: "", ...over,
  });
  for (const [i, id] of ["p1", "a", "b", "c"].entries()) {
    db._set("scores", `sc_${id}`, { seasonId: "s1", gameCategory: "billiards", lineUserId: id, totalScore: 100 - i, displayName: id });
  }
}
const legacyEvent = (over: Record<string, unknown> = {}) => ({
  seasonId: "s1", name: "旧", eventDate: "2000-01-01", status: "setup",
  entrants: [{ lineUserId: "a", displayName: "a", rank: 1, seed: false }, { lineUserId: "b", displayName: "b", rank: 2, seed: false }],
  rounds: [], championId: null, runnerUpId: null, thirdId: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "", ...over,
});

beforeEach(() => { (getActiveSeason as jest.Mock).mockResolvedValue({ seasonId: "s1" }); });

test("リーグ戦に出ていない人（scores 0件）は参加できない（403）。0点でも scores が1件あれば参加できる", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db); asUser("x");
  expect((await POST(req())).status).toBe(403);
  db._set("scores", "sc_x", { seasonId: "s1", gameCategory: "billiards", lineUserId: "x", totalScore: 0, displayName: "x" });
  expect((await POST(req())).status).toBe(200);
});

test("参加表明すると billiardsCsEvents に段 B1〜B3 と順位つきで入る", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db); asUser("a");
  expect((await POST(req())).status).toBe(200);
  const entry = (db._get("billiardsCsEvents", "cs1").entries as { lineUserId: string; tier: string; rank: number; state: string }[])[0];
  expect(entry).toMatchObject({ lineUserId: "a", tier: "B1", rank: 2, state: "confirmed" });
});

test("優先枠のぶんを残して定員を超えたらキャンセル待ち。受付中は取り消せる", async () => {
  const db = makeCsDb(); seed(db, { capacity: 2 }); (getDb as jest.Mock).mockReturnValue(db);
  asUser("a"); await POST(req());
  asUser("b"); expect((await (await POST(req())).json()).state).toBe("waitlisted");
  expect((await DELETE(req())).status).toBe(200);
  expect((db._get("billiardsCsEvents", "cs1").entries as unknown[])).toHaveLength(1);
});

test("旧形式（定員なし）のビリヤードCSには参加も取消もできない（409）", async () => {
  const db = makeCsDb(); (getDb as jest.Mock).mockReturnValue(db); asUser("c");
  db._set("billiardsCsEvents", "old", legacyEvent());
  db._set("scores", "sc_c", { seasonId: "s1", gameCategory: "billiards", lineUserId: "c", totalScore: 1, displayName: "c" });
  expect((await POST(req())).status).toBe(409);
  asUser("a");
  const res = await DELETE(req());
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("旧形式のCSは変更できません");
  expect(db._get("billiardsCsEvents", "old").entrants).toHaveLength(2);
});

test("GET は billiardsCsEvents を seasonId の1条件だけで読み、scores は読まない（自動更新で読み取りを増やさない）", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db); asUser("a");
  const body = await (await GET(req())).json();
  expect(body.event).toMatchObject({ name: "ビリヤードCS", capacity: 3, myEntry: null, podium: null });
  expect(db.reads).toEqual(["billiardsCsEvents"]);
});

test("GET は旧形式の setup を、開催日を過ぎていても自動で始めない（閲覧だけ）", async () => {
  const db = makeCsDb(); (getDb as jest.Mock).mockReturnValue(db); asUser("a");
  db._set("billiardsCsEvents", "old", legacyEvent());
  const body = await (await GET(req())).json();
  expect(body.event).toMatchObject({ status: "setup", capacity: null });
  expect(db._get("billiardsCsEvents", "old")).toMatchObject({ status: "setup", rounds: [] });
});

test("GET は lineUserId を返さない", async () => {
  const db = makeCsDb(); (getDb as jest.Mock).mockReturnValue(db); asUser("a");
  seed(db, { status: "finished", championId: "a", podium: { gold: "a", silver: "b", bronze: null },
    entrants: [{ lineUserId: "a", displayName: "エース", tier: "B1", rank: 1, seed: false }, { lineUserId: "b", displayName: "ビー", tier: "B2", rank: 2, seed: false }] });
  const body = await (await GET(req())).json();
  expect(body.event.podium).toEqual({ gold: { displayName: "エース", pictureUrl: "" }, silver: { displayName: "ビー", pictureUrl: "" }, bronze: null });
  expect(JSON.stringify(body)).not.toContain("lineUserId");
});

test("旧方式の窓口と処理は無い（/cs/report・自動生成）", () => {
  for (const path of ["src/app/api/billiards/cs/report/route.ts", "src/lib/billiardsCs.ts", "src/lib/billiardsCsServer.ts"]) {
    expect(existsSync(join(process.cwd(), path))).toBe(false);
  }
});
