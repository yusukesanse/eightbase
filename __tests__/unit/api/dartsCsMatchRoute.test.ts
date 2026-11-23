/**
 * PATCH /api/darts/cs/match（カウントアップの点数＋追加スローの自己申告）の回帰テスト。
 * 同点の追加勝負は通過の境目をまたぐ組だけ、全員そろうまで確定しない。
 */
jest.mock("@/lib/auth", () => ({ requireGameUser: jest.fn() }));
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/env", () => ({ isProduction: jest.fn().mockReturnValue(false) }));

import { PATCH } from "@/app/api/darts/cs/match/route";
import { requireGameUser } from "@/lib/auth";
import { getDb } from "@/lib/firebaseAdmin";
import { makeCsDb } from "../../helpers/csDb";
import { existsSync } from "fs";
import { join } from "path";
import type { NextRequest } from "next/server";

const send = (uid: string, b: Record<string, unknown>) => {
  (requireGameUser as jest.Mock).mockResolvedValue(uid);
  return PATCH({ json: async () => ({ csEventId: "cs1", ...b }) } as unknown as NextRequest);
};
const pl = (id: string) => ({ lineUserId: id, displayName: id, points: null, rank: null });

function seed(db: ReturnType<typeof makeCsDb>, over: Record<string, unknown> = {}) {
  db._set("dartsCsEvents", "cs1", {
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
  (db._get("dartsCsEvents", "cs1").rounds as { matches: { status: string; players: { lineUserId: string; points: number | null; rank: number | null; tiebreakPoints?: number[] }[] }[] }[])[i].matches[0];

test("自分の卓以外は申告できない", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  expect((await send("d", { matchId: "P", points: 10 })).status).toBe(403);
});

test("点数は0〜1,000,000の整数", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  expect((await send("a", { matchId: "P", points: -1 })).status).toBe(400);
  const res = await send("a", { matchId: "P", points: 1.5 });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("点数は0〜1,000,000の整数で入力してください");
});

test("旧 /api/darts/cs/report の窓口は無い", () => {
  expect(existsSync(join(process.cwd(), "src/app/api/darts/cs/report/route.ts"))).toBe(false);
});

test("4人卓: 全員が申告するまで確定せず、上位2名通過で2位と3位の同点だけ追加スローになる", async () => {
  const db = makeCsDb(); (getDb as jest.Mock).mockReturnValue(db);
  const ids = ["a", "b", "c", "d"];
  seed(db, { rounds: [
    { type: "prelim", label: "準決勝", advanceCount: 2, matches: [{ matchId: "P", label: "準決勝卓", status: "reporting", advanceCount: 2,
      players: ids.map(pl), seats: ids.map((id) => ({ kind: "player", lineUserId: id })) }] },
    { type: "final", label: "決勝", advanceCount: 2, matches: [{ matchId: "F", label: "決勝卓", status: "reporting", advanceCount: 2,
      players: [], seats: [1, 2].map((place) => ({ kind: "ticket", fromMatchId: "P", place })) }] },
  ] });
  await send("a", { matchId: "P", points: 700 });
  await send("b", { matchId: "P", points: 500 });
  await send("c", { matchId: "P", points: 500 });
  expect(match(db, 0).status).toBe("reporting");
  expect((await (await send("d", { matchId: "P", points: 100 })).json()).status).toBe("tiebreak");
  // 対象は b・c だけ。1位の a と4位の d は入れられない
  expect((await send("a", { matchId: "P", points: 1 })).status).toBe(409);
  expect((await (await send("d", { matchId: "P", points: 1 })).json()).error).toBe("追加スローの対象ではありません");
  await send("b", { matchId: "P", points: 40 });
  await send("c", { matchId: "P", points: 60 });
  expect(match(db, 0).status).toBe("completed");
  expect(match(db, 1).players.map((p) => p.lineUserId)).toEqual(["a", "c"]);
});

test("通過する人どうし（1位と2位）の同点は追加スローにならず、そのまま確定する", async () => {
  const db = makeCsDb(); (getDb as jest.Mock).mockReturnValue(db);
  const ids = ["a", "b", "c", "d"];
  seed(db, { rounds: [
    { type: "prelim", label: "準決勝", advanceCount: 2, matches: [{ matchId: "P", label: "準決勝卓", status: "reporting", advanceCount: 2,
      players: ids.map(pl), seats: ids.map((id) => ({ kind: "player", lineUserId: id })) }] },
    { type: "final", label: "決勝", advanceCount: 2, matches: [{ matchId: "F", label: "決勝卓", status: "reporting", advanceCount: 2,
      players: [], seats: [1, 2].map((place) => ({ kind: "ticket", fromMatchId: "P", place })) }] },
  ] });
  for (const [id, pts] of [["a", 600], ["b", 600], ["c", 300], ["d", 300]] as const) await send(id, { matchId: "P", points: pts });
  expect(match(db, 0).status).toBe("completed");
  expect(match(db, 1).players.map((p) => p.lineUserId).sort()).toEqual(["a", "b"]);
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

test("境目の同点は追加スローを待ち、対象外の人は入れられない", async () => {
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
  expect(db._get("dartsCsEvents", "cs1")).toMatchObject({ status: "finished", championId: "d",
    podium: { gold: "d", silver: "e", bronze: "a" } });
});

test("旧形式のダーツCSには申告できない", async () => {
  const db = makeCsDb(); seed(db, { capacity: undefined }); (getDb as jest.Mock).mockReturnValue(db);
  expect((await send("a", { matchId: "P", points: 10 })).status).toBe(409);
});

test("確定済みの卓は申告できない", async () => {
  const db = makeCsDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  for (const [id, pts] of [["a", 30], ["b", 20], ["c", 10]] as const) await send(id, { matchId: "P", points: pts });
  expect((await send("a", { matchId: "P", points: 1 })).status).toBe(409);
});

test("expectedStatus が今の卓の状態と違えば 409 で保存しない（シートを開いている間に追加スローへ変わった）", async () => {
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
