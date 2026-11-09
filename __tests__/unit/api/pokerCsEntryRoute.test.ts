jest.mock("@/lib/auth", () => ({ requireGameUser: jest.fn() }));
jest.mock("@/lib/mahjong", () => ({ getActiveSeason: jest.fn() }));
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/auditLog", () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));

import { POST, DELETE } from "@/app/api/poker/cs/entry/route";
import { GET } from "@/app/api/poker/cs/route";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { getDb } from "@/lib/firebaseAdmin";
import { makeCsDb } from "../../helpers/csDb";
import type { NextRequest } from "next/server";

const req = () => ({ json: async () => ({}) } as unknown as NextRequest);
const asUser = (id: string) => (requireGameUser as jest.Mock).mockResolvedValue(id);

function seed(db: ReturnType<typeof makeCsDb>, over: Record<string, unknown> = {}) {
  db._set("pokerCsEvents", "cs1", {
    csEventId: "cs1", seasonId: "s1", name: "ポーカーCS", eventDate: "2099-10-20",
    status: "entry", capacity: 3, priorityUserIds: ["p1"],
    entryOpensAt: "2026-10-01T00:00:00+09:00", entryClosesAt: "2099-01-01T00:00:00+09:00",
    entries: [], entrants: [], rounds: [], createdAt: "2026-10-01T00:00:00Z", updatedAt: "", ...over,
  });
  for (const [i, id] of ["p1", "a", "b", "c"].entries()) {
    db._set("scores", `sc_${id}`, { seasonId: "s1", gameCategory: "poker", lineUserId: id, totalScore: 100 - i, displayName: id });
  }
}

beforeEach(() => { (getActiveSeason as jest.Mock).mockResolvedValue({ seasonId: "s1" }); });

test("リーグ戦に出ていない人は参加できない（403）", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db); asUser("x");
  const res = await POST(req());
  expect(res.status).toBe(403);
});

test("参加表明すると pokerCsEvents に段 P1〜P3 と順位つきで入る", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db); asUser("a");
  const res = await POST(req());
  expect(res.status).toBe(200);
  const entry = (db._get("pokerCsEvents", "cs1").entries as { lineUserId: string; tier: string; rank: number; state: string }[])[0];
  expect(entry).toMatchObject({ lineUserId: "a", tier: "P1", rank: 2, state: "confirmed" });
  expect(db._get("mahjongCsEvents", "cs1")).toBeUndefined();
});

test("優先枠のぶんを残して定員を超えたらキャンセル待ち", async () => {
  const db = makeCsDb(); seed(db, { capacity: 2 }); (getDb as jest.Mock).mockReturnValue(db);
  asUser("a"); await POST(req());
  asUser("b"); const res = await POST(req());
  expect((await res.json()).state).toBe("waitlisted");
});

test("旧形式（定員なし）のポーカーCSには参加できない", async () => {
  const db = makeCsDb(); seed(db, { capacity: undefined, status: "setup" }); (getDb as jest.Mock).mockReturnValue(db); asUser("a");
  expect((await POST(req())).status).toBe(409);
});

test("受付中は取り消せる", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db); asUser("a");
  await POST(req());
  expect((await DELETE(req())).status).toBe(200);
  expect(db._get("pokerCsEvents", "cs1").entries).toEqual([]);
});

test("GET は pokerCsEvents を seasonId の1条件だけで読み、scores は読まない", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db); asUser("a");
  const res = await GET(req());
  const body = await res.json();
  expect(body.event).toMatchObject({ name: "ポーカーCS", capacity: 3, myEntry: null, podium: null });
  expect(db.reads.filter((c) => c === "scores")).toHaveLength(0);
});

test("GET は旧形式の setup でも自動で組み合わせを作らない", async () => {
  const db = makeCsDb(); (getDb as jest.Mock).mockReturnValue(db); asUser("a");
  db._set("pokerCsEvents", "old", { seasonId: "s1", name: "旧", eventDate: "2000-01-01", status: "setup",
    entrants: [{ lineUserId: "a", displayName: "a", rank: 1, seed: false }, { lineUserId: "b", displayName: "b", rank: 2, seed: false }],
    rounds: [], createdAt: "2026-01-01T00:00:00Z", updatedAt: "" });
  const body = await (await GET(req())).json();
  expect(body.event.status).toBe("setup");
  expect(db._get("pokerCsEvents", "old").rounds).toEqual([]);
});

test("GET は podium の lineUserId を entrants の名前・画像に解決して返す", async () => {
  const db = makeCsDb(); (getDb as jest.Mock).mockReturnValue(db); asUser("a");
  seed(db, {
    status: "finished", championId: "a", podium: { gold: "a", silver: "b", bronze: null },
    entrants: [
      { lineUserId: "a", displayName: "エース", pictureUrl: "https://img/a.png", tier: "P1", rank: 1, seed: false },
      { lineUserId: "b", displayName: "ビー", tier: "P2", rank: 2, seed: false },
    ],
  });
  const body = await (await GET(req())).json();
  expect(body.event.podium).toEqual({
    gold: { displayName: "エース", pictureUrl: "https://img/a.png" },
    silver: { displayName: "ビー", pictureUrl: "" },
    bronze: null,
  });
  expect(JSON.stringify(body)).not.toContain("lineUserId");
});

test("GET の tiebreakMine は追加勝負の対象者だけ true", async () => {
  const db = makeCsDb(); (getDb as jest.Mock).mockReturnValue(db);
  const pl = (id: string, points: number) => ({ lineUserId: id, displayName: id, points, rank: null });
  seed(db, {
    status: "running",
    entrants: ["a", "b", "c"].map((id, i) => ({ lineUserId: id, displayName: id, tier: "P1", rank: i + 1, seed: false })),
    rounds: [{ type: "prelim", label: "準決勝", advanceCount: 1, matches: [{
      matchId: "P", label: "準決勝卓", status: "tiebreak", advanceCount: 1,
      players: [pl("a", 50), pl("b", 50), pl("c", 10)],
      seats: ["a", "b", "c"].map((id) => ({ kind: "player", lineUserId: id })),
    }] }],
  });
  asUser("a");
  expect((await (await GET(req())).json()).event.rounds[0].matches[0].tiebreakMine).toBe(true);
  asUser("c");
  expect((await (await GET(req())).json()).event.rounds[0].matches[0].tiebreakMine).toBe(false);
});

test("GET は旧形式のポーカーCSで chips だけ持つ選手の値を points に出す", async () => {
  const db = makeCsDb(); (getDb as jest.Mock).mockReturnValue(db); asUser("a");
  db._set("pokerCsEvents", "old", { seasonId: "s1", name: "旧", eventDate: "2000-01-01", status: "finished", championId: "a",
    entrants: [{ lineUserId: "a", displayName: "a", rank: 1, seed: false }, { lineUserId: "b", displayName: "b", rank: 2, seed: false }],
    rounds: [{ type: "final", label: "決勝", advanceCount: 1, matches: [{ matchId: "F", label: "決勝卓", status: "completed",
      players: [{ lineUserId: "a", displayName: "a", chips: 300, rank: 1 }, { lineUserId: "b", displayName: "b", chips: 100, rank: 2 }] }] }],
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "" });
  const body = await (await GET(req())).json();
  expect(body.event.rounds[0].matches[0].players.map((p: { points: number | null }) => p.points)).toEqual([300, 100]);
});

test("GET の tiebreakSubmitted は対象者が今の回の追加ハンドを送ったときだけ true。対象外には出さない", async () => {
  const db = makeCsDb(); (getDb as jest.Mock).mockReturnValue(db);
  const pl = (id: string, points: number, tiebreakPoints?: number[]) =>
    ({ lineUserId: id, displayName: id, points, rank: null, ...(tiebreakPoints ? { tiebreakPoints } : {}) });
  seed(db, {
    status: "running",
    entrants: ["a", "b", "c"].map((id, i) => ({ lineUserId: id, displayName: id, tier: "P1", rank: i + 1, seed: false })),
    rounds: [{ type: "prelim", label: "準決勝", advanceCount: 1, matches: [{
      matchId: "P", label: "準決勝卓", status: "tiebreak", advanceCount: 1,
      players: [pl("a", 50, [7]), pl("b", 50), pl("c", 10)],
      seats: ["a", "b", "c"].map((id) => ({ kind: "player", lineUserId: id })),
    }] }],
  });
  const matchFor = async (id: string) => {
    asUser(id);
    return (await (await GET(req())).json()).event.rounds[0].matches[0];
  };
  expect(await matchFor("a")).toMatchObject({ tiebreakMine: true, tiebreakSubmitted: true });
  expect(await matchFor("b")).toMatchObject({ tiebreakMine: true, tiebreakSubmitted: false });
  const other = await matchFor("c");
  expect(other.tiebreakMine).toBe(false);
  expect("tiebreakSubmitted" in other).toBe(false);
});

test("旧形式（定員なし）のポーカーCSは DELETE でも entrants から消せない（409）", async () => {
  const db = makeCsDb(); (getDb as jest.Mock).mockReturnValue(db); asUser("a");
  seed(db, { capacity: undefined, status: "setup",
    entrants: [{ lineUserId: "a", displayName: "a", rank: 1, seed: false }, { lineUserId: "b", displayName: "b", rank: 2, seed: false }] });
  const res = await DELETE(req());
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("旧形式のCSは変更できません");
  expect(db._get("pokerCsEvents", "cs1").entrants).toHaveLength(2);
});
