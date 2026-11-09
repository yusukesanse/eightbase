/**
 * PATCH /api/poker/cs/match（チップ＋追加ハンドの自己申告）の回帰テスト。
 * 同点の追加勝負は通過の境目をまたぐ組だけ、全員そろうまで確定しない。
 */
jest.mock("@/lib/auth", () => ({ requireGameUser: jest.fn() }));
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/env", () => ({ isProduction: jest.fn().mockReturnValue(false) }));

import { PATCH } from "@/app/api/poker/cs/match/route";
import { requireGameUser } from "@/lib/auth";
import { getDb } from "@/lib/firebaseAdmin";
import { makeCsDb } from "../../helpers/csDb";
import type { NextRequest } from "next/server";

const send = (uid: string, b: Record<string, unknown>) => {
  (requireGameUser as jest.Mock).mockResolvedValue(uid);
  return PATCH({ json: async () => ({ csEventId: "cs1", ...b }) } as unknown as NextRequest);
};
const pl = (id: string) => ({ lineUserId: id, displayName: id, points: null, rank: null });

function seed(db: ReturnType<typeof makeCsDb>, over: Record<string, unknown> = {}) {
  db._set("pokerCsEvents", "cs1", {
    seasonId: "s1", name: "CS", eventDate: "2099-12-01", status: "running", capacity: 5, priorityUserIds: [], entries: [],
    entrants: ["a", "b", "c", "d", "e"].map((id, i) => ({ lineUserId: id, displayName: id, rank: i + 1, seed: false })),
    rounds: [
      { type: "prelim", label: "準決勝", advanceCount: 1, matches: [{ matchId: "P", label: "準決勝卓", status: "reporting", advanceCount: 1,
        players: ["a", "b", "c"].map(pl), seats: ["a", "b", "c"].map((id) => ({ kind: "player", lineUserId: id })) }] },
      { type: "final", label: "決勝", advanceCount: 3, matches: [{ matchId: "F", label: "決勝卓", status: "reporting", advanceCount: 3,
        players: ["d", "e"].map(pl), seats: [{ kind: "ticket", fromMatchId: "P", place: 1 }, ...["d", "e"].map((id) => ({ kind: "player", lineUserId: id }))] }] },
    ],
    createdAt: "", updatedAt: "", ...over,
  });
}
const match = (db: ReturnType<typeof makeCsDb>, i: number) =>
  (db._get("pokerCsEvents", "cs1").rounds as { matches: { status: string; players: { lineUserId: string; points: number | null; rank: number | null; tiebreakPoints?: number[] }[] }[] }[])[i].matches[0];

test("自分の卓以外は申告できない", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  expect((await send("d", { matchId: "P", points: 10 })).status).toBe(403);
});

test("チップは0〜1,000,000の整数", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  expect((await send("a", { matchId: "P", points: -1 })).status).toBe(400);
  expect((await send("a", { matchId: "P", points: 1.5 })).status).toBe(400);
});

test("札の席がそろっていない卓は申告できない", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  expect((await send("d", { matchId: "F", points: 10 })).status).toBe(409);
});

test("全員そろうと確定し、1位が決勝の札の席へ", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  await send("a", { matchId: "P", points: 30 });
  await send("b", { matchId: "P", points: 20 });
  const res = await send("c", { matchId: "P", points: 10 });
  expect((await res.json()).status).toBe("completed");
  expect(match(db, 1).players.map((p) => p.lineUserId).sort()).toEqual(["a", "d", "e"]);
});

test("境目の同点は追加ハンドを待ち、対象外の人は入れられない", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  await send("a", { matchId: "P", points: 50 });
  await send("b", { matchId: "P", points: 50 });
  const res = await send("c", { matchId: "P", points: 10 });
  const json = await res.json();
  expect(json.status).toBe("tiebreak");
  expect(match(db, 0).status).toBe("tiebreak");
  expect((await send("c", { matchId: "P", points: 99 })).status).toBe(409);
  await send("a", { matchId: "P", points: 3 });
  expect(match(db, 0).status).toBe("tiebreak");
  await send("b", { matchId: "P", points: 7 });
  expect(match(db, 0).status).toBe("completed");
  expect(match(db, 1).players.map((p) => p.lineUserId).sort()).toEqual(["b", "d", "e"]);
});

test("決勝が確定すると finished・championId・podium が入る", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  for (const [id, pts] of [["a", 30], ["b", 20], ["c", 10]] as const) await send(id, { matchId: "P", points: pts });
  for (const [id, pts] of [["a", 5], ["d", 9], ["e", 7]] as const) await send(id, { matchId: "F", points: pts });
  expect(db._get("pokerCsEvents", "cs1")).toMatchObject({ status: "finished", championId: "d",
    podium: { gold: "d", silver: "e", bronze: "a" } });
});

test("旧形式のポーカーCSには申告できない", async () => {
  const db = makeCsDb(); seed(db, { capacity: undefined }); (getDb as jest.Mock).mockReturnValue(db);
  expect((await send("a", { matchId: "P", points: 10 })).status).toBe(409);
});

test("確定済みの卓は申告できない", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  for (const [id, pts] of [["a", 30], ["b", 20], ["c", 10]] as const) await send(id, { matchId: "P", points: pts });
  expect((await send("a", { matchId: "P", points: 1 })).status).toBe(409);
});

test("expectedStatus が今の卓の状態と違えば 409 で保存しない（シートを開いている間に追加ハンドへ変わった）", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  await send("a", { matchId: "P", points: 50 });
  await send("b", { matchId: "P", points: 50 });
  await send("c", { matchId: "P", points: 10 });
  expect(match(db, 0).status).toBe("tiebreak");
  const res = await send("a", { matchId: "P", points: 60, expectedStatus: "reporting" });
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("卓の状態が変わりました。画面を更新してください");
  expect(match(db, 0).players.find((p) => p.lineUserId === "a")?.tiebreakPoints).toBeUndefined();
});

test("expectedStatus が一致すれば保存し、送られなければ従来どおり通す", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  expect((await send("a", { matchId: "P", points: 30, expectedStatus: "reporting" })).status).toBe(200);
  expect((await send("b", { matchId: "P", points: 20 })).status).toBe(200);
  expect(match(db, 0).players.map((p) => p.points)).toEqual([30, 20, null]);
});

test("応答に同卓者の lineUserId を出さない（tiebreakIds・championId を返さない）", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  await send("a", { matchId: "P", points: 50 });
  await send("b", { matchId: "P", points: 50 });
  const tie = await (await send("c", { matchId: "P", points: 10 })).json();
  expect(Object.keys(tie).sort()).toEqual(["eventStatus", "status", "success"]);
  await send("a", { matchId: "P", points: 3 });
  await send("b", { matchId: "P", points: 7 });
  for (const [id, pts] of [["b", 5], ["d", 9]] as const) await send(id, { matchId: "F", points: pts });
  const done = await (await send("e", { matchId: "F", points: 7 })).json();
  expect(done).toEqual({ success: true, status: "completed", eventStatus: "finished" });
});
