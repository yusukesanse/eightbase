jest.mock("@/lib/auth", () => ({ requireGameUser: jest.fn() }));
jest.mock("@/lib/session", () => ({ getSessionUserId: jest.fn() }));
jest.mock("@/lib/mahjong", () => ({ getActiveSeason: jest.fn() }));
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/auditLog", () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));

import { POST, DELETE } from "@/app/api/mahjong/cs/entry/route";
import { GET } from "@/app/api/mahjong/cs/route";
import { requireGameUser } from "@/lib/auth";
import { getSessionUserId } from "@/lib/session";
import { getActiveSeason } from "@/lib/mahjong";

import { getDb } from "@/lib/firebaseAdmin";
import type { NextRequest } from "next/server";

type Data = Record<string, unknown>;

function makeDb() {
  const store = new Map<string, Map<string, Data>>();
  const col = (n: string) => {
    if (!store.has(n)) store.set(n, new Map());
    return store.get(n)!;
  };
  const docRef = (c: string, id: string) => ({
    __c: c,
    id,
    get: async () => ({ exists: col(c).has(id), id, data: () => col(c).get(id) }),
    set: async (d: Data) => { col(c).set(id, { ...d }); },
    update: async (d: Data) => {
      const cur = col(c).get(id) ?? {};
      col(c).set(id, { ...cur, ...d });
    },
    delete: async () => { col(c).delete(id); },
  });
  const query = (c: string, conds: [string, string, unknown][], lim?: number) => ({
    where: (f: string, op: string, v: unknown) => query(c, [...conds, [f, op, v]], lim),
    limit: (n: number) => query(c, conds, n),
    get: async () => {
      const rows = [...col(c).entries()]
        .filter(([, v]) => conds.every(([f, op, val]) => {
          if (op === "array-contains") return Array.isArray(v[f]) && (v[f] as unknown[]).includes(val);
          if (op === "==") return v[f] === val;
          throw new Error(`Unsupported operator: ${op}`);
        }))
        .map(([id, v]) => ({ id, data: () => v }));
      const docs = lim == null ? rows : rows.slice(0, lim);
      return { docs, empty: docs.length === 0, size: docs.length };
    },
  });
  return {
    runTransaction: async <T>(fn: (tx: {
      get: (ref: ReturnType<typeof docRef>) => ReturnType<ReturnType<typeof docRef>["get"]>;
      set: (ref: ReturnType<typeof docRef>, d: Data, opt?: { merge?: boolean }) => void;
      update: (ref: ReturnType<typeof docRef>, d: Data) => void;
    }) => Promise<T>) => {
      const tx = {
        get: (ref: ReturnType<typeof docRef>) => ref.get(),
        set: (ref: ReturnType<typeof docRef>, d: Data, opt?: { merge?: boolean }) => {
          const cur = opt?.merge ? (col(ref.__c).get(ref.id) ?? {}) : {};
          col(ref.__c).set(ref.id, { ...cur, ...d });
        },
        update: (ref: ReturnType<typeof docRef>, d: Data) => {
          const cur = col(ref.__c).get(ref.id) ?? {};
          col(ref.__c).set(ref.id, { ...cur, ...d });
        },
      };
      return await fn(tx);
    },
    batch: () => {
      const ops: [string, string, Data, boolean][] = [];
      return {
        // merge:true は既存フィールドを残す（paymentTransactionId 等を消さない）。
        set: (ref: { __c: string; id: string }, d: Data, opt?: { merge?: boolean }) => {
          ops.push([ref.__c, ref.id, d, opt?.merge === true]);
        },
        commit: async () => {
          ops.forEach(([c, id, d, merge]) => {
            col(c).set(id, merge ? { ...(col(c).get(id) ?? {}), ...d } : { ...d });
          });
        },
      };
    },
    collection: (c: string) => ({
      doc: (id: string) => docRef(c, id),
      where: (f: string, op: string, v: unknown) => query(c, [[f, op, v]]),
    }),
    __store: store,
    _get: (c: string, id: string) => store.get(c)!.get(id)!,
    _set: (c: string, id: string, d: Data) => col(c).set(id, d),
  };
}

const SEASON = "s1";
function seed(db: ReturnType<typeof makeDb>, over: Record<string, unknown> = {}) {
  db._set("mahjongCsEvents", "cs1", {
    csEventId: "cs1", seasonId: SEASON, name: "CS", eventDate: "2026-10-20",
    status: "entry", capacity: 3, priorityUserIds: ["p1"],
    entryOpensAt: "2026-10-01T00:00:00+09:00", entryClosesAt: "2099-01-01T00:00:00+09:00",
    entries: [], entrants: [], rounds: [], createdAt: "2026-10-01T00:00:00Z", updatedAt: "",
    ...over,
  });
  for (const id of ["a", "b", "c", "p1"]) {
    db._set("mahjongTables", `t_${id}`, { seasonId: SEASON, memberIds: [id], status: "completed" });
  }
}
const asUser = (id: string) => (requireGameUser as jest.Mock).mockResolvedValue(id);
const req = () => ({ json: async () => ({}) } as unknown as NextRequest);

beforeEach(() => { (getActiveSeason as jest.Mock).mockResolvedValue({ seasonId: SEASON }); });

it("リーグ戦に一度も出ていない人は 403", async () => {
  const db = makeDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  asUser("nobody");
  expect((await POST(req())).status).toBe(403);
});

it("別シーズンや申告待ちの卓だけの人も 403", async () => {
  const db = makeDb(); seed(db);
  db._set("mahjongTables", "t_x1", { seasonId: "old", memberIds: ["x"], status: "completed" });
  db._set("mahjongTables", "t_x2", { seasonId: SEASON, memberIds: ["x"], status: "reporting" });
  (getDb as jest.Mock).mockReturnValue(db); asUser("x");
  expect((await POST(req())).status).toBe(403);
});

it("M3枠（定員3 − 優先1 = 2）を超えたらキャンセル待ち、優先枠は満員でも確定", async () => {
  const db = makeDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  for (const id of ["a", "b", "c", "p1"]) { asUser(id); await POST(req()); }
  const entries = db._get("mahjongCsEvents", "cs1").entries as { lineUserId: string; state: string }[];
  expect(Object.fromEntries(entries.map((e) => [e.lineUserId, e.state])))
    .toEqual({ a: "confirmed", b: "confirmed", c: "waitlisted", p1: "confirmed" });
});

it("受付中に M3 の確定者が取り消すと、キャンセル待ち1番目が繰り上がる", async () => {
  const db = makeDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  for (const id of ["a", "b", "c"]) { asUser(id); await POST(req()); }
  asUser("a"); await DELETE(req());
  const entries = db._get("mahjongCsEvents", "cs1").entries as { lineUserId: string; state: string }[];
  expect(entries.find((e) => e.lineUserId === "c")!.state).toBe("confirmed");
});

it("受付開始前は 409", async () => {
  const db = makeDb(); seed(db, { entryOpensAt: "2099-01-01T00:00:00+09:00" });
  (getDb as jest.Mock).mockReturnValue(db); asUser("a");
  expect((await POST(req())).status).toBe(409);
});

it("締切後は参加表明も取り消しも 409", async () => {
  const db = makeDb(); seed(db, { status: "closed", entries: [] });
  (getDb as jest.Mock).mockReturnValue(db); asUser("a");
  expect((await POST(req())).status).toBe(409);
  expect((await DELETE(req())).status).toBe(409);
});

it("同じ人の2回目の表明は冪等（200・重複しない）", async () => {
  const db = makeDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db); asUser("a");
  await POST(req()); const res = await POST(req());
  expect(res.status).toBe(200);
  expect((db._get("mahjongCsEvents", "cs1").entries as unknown[]).length).toBe(1);
});

it("GET: 締切を過ぎていれば最初のアクセスで closed にし、未表明の優先枠ぶん繰り上げる", async () => {
  const db = makeDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  for (const id of ["a", "b", "c"]) { asUser(id); await POST(req()); }
  const doc = db._get("mahjongCsEvents", "cs1");
  db._set("mahjongCsEvents", "cs1", { ...doc, entryClosesAt: "2000-01-01T00:00:00+09:00" });
  (getSessionUserId as jest.Mock).mockResolvedValue("c");
  const body = await (await GET(req())).json();
  expect(body.event.status).toBe("closed");
  expect(body.event.myEntry).toEqual({ state: "confirmed", waitlistPosition: null });
  expect(JSON.stringify(body)).not.toContain("lineUserId");
});

it("未認証の POST/DELETE/GET は 401", async () => {
  (requireGameUser as jest.Mock).mockResolvedValue(null);
  (getSessionUserId as jest.Mock).mockResolvedValue(null);
  expect((await POST(req())).status).toBe(401);
  expect((await DELETE(req())).status).toBe(401);
  expect((await GET(req())).status).toBe(401);
});

it("参加表明は ISO 時刻と編成の tier/rank を保存し、待ち順位を返す", async () => {
  const db = makeDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  db._set("mahjongLeagueAssignments", "asgn", {
    seasonId: SEASON, confirmedAt: "2026-10-01T00:00:00Z",
    entries: [{ lineUserId: "a", tier: "M2", rank: 7 }],
  });
  for (const id of ["a", "b", "c"]) { asUser(id); await POST(req()); }
  const entries = db._get("mahjongCsEvents", "cs1").entries as Data[];
  expect(entries[0]).toMatchObject({ tier: "M2", rank: 7 });
  expect(entries[1]).toMatchObject({ tier: "M3", rank: 100000 });
  expect(new Date(entries[0].enteredAt as string).toISOString()).toBe(entries[0].enteredAt);
  expect(await (await POST(req())).json()).toEqual({
    success: true, entered: true, state: "waitlisted", waitlistPosition: 1,
  });
  (getSessionUserId as jest.Mock).mockResolvedValue("c");
  const body = await (await GET(req())).json();
  expect(body.entered).toBe(true);
  expect(body.event).toMatchObject({ capacity: 3, confirmedCount: 2, waitlistCount: 1,
    myEntry: { state: "waitlisted", waitlistPosition: 1 },
    entryOpensAt: "2026-10-01T00:00:00+09:00", entryClosesAt: "2099-01-01T00:00:00+09:00" });
});

it("締切時刻ちょうどなら entry のままでも POST/DELETE は拒否する", async () => {
  jest.useFakeTimers().setSystemTime(new Date("2026-10-09T00:00:00+09:00"));
  try {
    const db = makeDb(); seed(db, { entryClosesAt: "2026-10-09T00:00:00+09:00" });
    (getDb as jest.Mock).mockReturnValue(db); asUser("a");
    expect((await POST(req())).status).toBe(409);
    expect((await DELETE(req())).status).toBe(409);
    expect(db._get("mahjongCsEvents", "cs1").entries).toEqual([]);
  } finally { jest.useRealTimers(); }
});

it("受付開始時刻ちょうどは参加でき、未表明者の取消は冪等", async () => {
  jest.useFakeTimers().setSystemTime(new Date("2026-10-01T00:00:00+09:00"));
  try {
    const db = makeDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db); asUser("a");
    expect(await (await DELETE(req())).json()).toEqual({ success: true, entered: false });
    expect(await (await POST(req())).json()).toEqual({
      success: true, entered: true, state: "confirmed", waitlistPosition: null,
    });
  } finally { jest.useRealTimers(); }
});

it("旧方式は開催日後も自動生成せず、参加を拒否し、公開互換項目と旧取消を保つ", async () => {
  const db = makeDb(); seed(db, { capacity: undefined, status: "setup", eventDate: "2000-01-01",
    entrants: ["a", "b", "c", "p1"].map((id) => ({ lineUserId: id, displayName: id, rank: 1, seed: false })) });
  (getDb as jest.Mock).mockReturnValue(db); asUser("a");
  (getSessionUserId as jest.Mock).mockResolvedValue("a");
  expect((await POST(req())).status).toBe(409);
  const body = await (await GET(req())).json();
  expect(body.entered).toBe(true);
  expect(body.event).toMatchObject({ status: "setup", rounds: [], capacity: null,
    entryOpensAt: null, entryClosesAt: null, confirmedCount: 4, waitlistCount: 0,
    myEntry: { state: "confirmed", waitlistPosition: null } });
  expect(JSON.stringify(body)).not.toContain("lineUserId");
  expect(await (await DELETE(req())).json()).toEqual({ success: true, entered: false, count: 3 });
});

it("公開対戦表は未解決の札だけラベルにし、選手や札の内部IDを返さない", async () => {
  const db = makeDb(); seed(db, { status: "running", rounds: [
    { type: "prelim", label: "予選", advanceCount: 2, matches: [
      { matchId: "p", label: "予選A卓", status: "completed", players: [
        { lineUserId: "a", displayName: "A", points: 40000, rank: 1 }], seats: [] }] },
    { type: "final", label: "決勝", advanceCount: 3, matches: [
      { matchId: "f", label: "決勝卓", status: "reporting", players: [], seats: [
        { kind: "ticket", fromMatchId: "p", place: 1 },
        { kind: "ticket", fromMatchId: "p", place: 2, lineUserId: "b" },
        { kind: "player", lineUserId: "c" }, null] }] },
  ] });
  (getDb as jest.Mock).mockReturnValue(db); (getSessionUserId as jest.Mock).mockResolvedValue("a");
  const body = await (await GET(req())).json();
  expect(body.event.rounds[1].matches[0].pendingSeats).toEqual(["予選A卓 1位"]);
  expect(body.event.rounds[0].matches[0].pendingSeats).toEqual([]);
  expect(body.event.rounds[0].matches[0].players[0].isMe).toBe(true);
  expect(JSON.stringify(body)).not.toContain("lineUserId");
});
