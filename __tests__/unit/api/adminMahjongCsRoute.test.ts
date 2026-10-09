jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/adminAuth", () => ({ checkAdminAuth: jest.fn().mockResolvedValue("admin@example.com") }));
jest.mock("@/lib/mahjong", () => ({ getActiveSeason: jest.fn() }));
jest.mock("@/lib/auditLog", () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/env", () => ({ isProduction: jest.fn().mockReturnValue(false) }));
jest.mock("firebase-admin/firestore", () => {
  const deleteSentinel = Symbol("FieldValue.delete");
  return { FieldValue: { delete: jest.fn(() => deleteSentinel) } };
});

import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getActiveSeason } from "@/lib/mahjong";
import { FieldValue, type DocumentData } from "firebase-admin/firestore";
import type { NextRequest } from "next/server";

type Data = Record<string, unknown>;

function makeDb() {
  const store = new Map<string, Map<string, Data>>();
  let nextId = 1;
  const applyUpdate = (current: Data, update: Data): Data => {
    const result = { ...current };
    for (const [key, value] of Object.entries(update)) {
      if (value === FieldValue.delete()) delete result[key];
      else result[key] = value;
    }
    return result;
  };
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
      col(c).set(id, applyUpdate(cur, d));
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
          col(ref.__c).set(ref.id, applyUpdate(cur, d));
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
      add: async (d: Data) => {
        let id: string;
        do { id = `auto_${nextId++}`; } while (col(c).has(id));
        const ref = docRef(c, id);
        await ref.set(d);
        return ref;
      },
      where: (f: string, op: string, v: unknown) => query(c, [[f, op, v]]),
    }),
    __store: store,
    // Match Firestore data() typing so the brief's assertions remain verbatim.
    _get: (c: string, id: string): DocumentData => store.get(c)!.get(id)!,
    _set: (c: string, id: string, d: Data) => col(c).set(id, d),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkAdminAuth as jest.Mock).mockResolvedValue("admin@example.com");
  (getActiveSeason as jest.Mock).mockResolvedValue({ seasonId: "s1" });
  (isProduction as jest.Mock).mockReturnValue(false);
});

import { POST } from "@/app/api/admin/mahjong/cs/route";
import { PATCH } from "@/app/api/admin/mahjong/cs/[csEventId]/route";
import { isProduction } from "@/lib/env";

const params = { params: Promise.resolve({ csEventId: "cs1" }) };
const body = (b: unknown) => ({ json: async () => b } as unknown as NextRequest);
const create = {
  name: "秋CS", eventDate: "2026-10-20", capacity: 6,
  entryOpensAt: "2026-10-01T00:00:00+09:00", entryClosesAt: "2026-10-08T00:00:00+09:00",
};

function withAssignment(db: ReturnType<typeof makeDb>) {
  db._set("mahjongLeagueAssignments", "as1", {
    seasonId: "s1", confirmedAt: "2026-09-30T00:00:00Z",
    entries: [
      { lineUserId: "m1", tier: "M1", rank: 1 }, { lineUserId: "m2", tier: "M2", rank: 5 },
      { lineUserId: "m3", tier: "M3", rank: 9 },
    ],
  });
}

it("作成: 優先枠は最新の確定編成の M1・M2 で固定し、status は entry", async () => {
  const db = makeDb(); withAssignment(db); (getDb as jest.Mock).mockReturnValue(db);
  const res = await POST(body(create));
  expect(res.status).toBe(201);
  const { event } = await res.json();
  expect(event.status).toBe("entry");
  expect(event.priorityUserIds.sort()).toEqual(["m1", "m2"]);
});

it.each([
  ["定員が整数でない", { capacity: 4.5 }],
  ["定員が3以下", { capacity: 3 }],
  ["締切が開始より前", { entryClosesAt: "2026-09-01T00:00:00+09:00" }],
  ["開催日の形式が不正", { eventDate: "2026/10/20" }],
])("作成: %s は 400", async (_, over) => {
  const db = makeDb(); withAssignment(db); (getDb as jest.Mock).mockReturnValue(db);
  expect((await POST(body({ ...create, ...over }))).status).toBe(400);
});

it("作成: 定員が優先枠より少ないと 400", async () => {
  const db = makeDb(); withAssignment(db); (getDb as jest.Mock).mockReturnValue(db);
  // 優先枠は2名。定員4は OK、ここでは優先枠を5名にして定員4を弾く
  db._set("mahjongLeagueAssignments", "as2", {
    seasonId: "s1", confirmedAt: "2026-10-01T00:00:00Z",
    entries: ["a", "b", "c", "d", "e"].map((id) => ({ lineUserId: id, tier: "M1", rank: 1 })),
  });
  expect((await POST(body({ ...create, capacity: 4 }))).status).toBe(400);
});

function closedEvent(db: ReturnType<typeof makeDb>) {
  const ids = ["a", "b", "c", "d"];
  db._set("mahjongCsEvents", "cs1", {
    csEventId: "cs1", seasonId: "s1", status: "closed", capacity: 4, priorityUserIds: [],
    entries: ids.map((id, i) => ({ lineUserId: id, displayName: id, tier: "M3", rank: 100000,
      enteredAt: `2026-10-01T00:0${i}:00Z`, state: "confirmed" })),
    entrants: ids.map((id) => ({ lineUserId: id, displayName: id, rank: 100000, seed: false })),
    rounds: [],
  });
}
const oneTable = (seats: unknown[]) => [{ type: "final", label: "決勝", advanceCount: 1,
  matches: [{ matchId: "F", label: "決勝卓", players: [], status: "reporting", seats }] }];
const P = (id: string) => ({ kind: "player", lineUserId: id });

it("確定: 検証 NG なら 400 と errors を返し、状態は変えない", async () => {
  const db = makeDb(); closedEvent(db); (getDb as jest.Mock).mockReturnValue(db);
  const res = await PATCH(body({ action: "confirmBracket", seedUserIds: [], rounds: oneTable([P("a"), P("b"), P("c"), null]) }), params);
  expect(res.status).toBe(400);
  expect((await res.json()).errors.length).toBeGreaterThan(0);
  expect(db._get("mahjongCsEvents", "cs1").status).toBe("closed");
});

it("確定: OK なら running になり、シードが entrants に反映される", async () => {
  const db = makeDb(); closedEvent(db); (getDb as jest.Mock).mockReturnValue(db);
  const res = await PATCH(body({ action: "confirmBracket", seedUserIds: ["a"], rounds: oneTable([P("a"), P("b"), P("c"), P("d")]) }), params);
  expect(res.status).toBe(200);
  const ev = db._get("mahjongCsEvents", "cs1");
  expect(ev.status).toBe("running");
  expect(ev.rounds[0].matches[0].players).toHaveLength(4);
  expect(ev.entrants.find((e: { lineUserId: string }) => e.lineUserId === "a").seed).toBe(true);
});

it("確定: 参加確定者でない人をシードにすると 400", async () => {
  const db = makeDb(); closedEvent(db); (getDb as jest.Mock).mockReturnValue(db);
  const res = await PATCH(body({ action: "confirmBracket", seedUserIds: ["zz"], rounds: oneTable([P("a"), P("b"), P("c"), P("d")]) }), params);
  expect(res.status).toBe(400);
});

it("受付中でない CS に closeNow は 409", async () => {
  const db = makeDb(); closedEvent(db); (getDb as jest.Mock).mockReturnValue(db);
  expect((await PATCH(body({ action: "closeNow" }), params)).status).toBe(409);
});

it("締切後に参加者を外すと、編成の下書きの席も空く", async () => {
  const db = makeDb(); closedEvent(db); (getDb as jest.Mock).mockReturnValue(db);
  await PATCH(body({ action: "saveBracket", seedUserIds: ["a"], rounds: oneTable([P("a"), P("b"), P("c"), P("d")]) }), params);
  await PATCH(body({ action: "removeEntry", lineUserId: "a" }), params);
  const ev = db._get("mahjongCsEvents", "cs1");
  expect(ev.bracket.rounds[0].matches[0].seats[0]).toBeNull();
  expect(ev.bracket.seedUserIds).toEqual([]);
  expect(ev.entrants.map((e: { lineUserId: string }) => e.lineUserId)).toEqual(["b", "c", "d"]);
});

it("fillDummies は本番では 404", async () => {
  (isProduction as jest.Mock).mockReturnValue(true);
  const db = makeDb(); closedEvent(db); (getDb as jest.Mock).mockReturnValue(db);
  expect((await PATCH(body({ action: "fillDummies" }), params)).status).toBe(404);
});

function entryEvent(db: ReturnType<typeof makeDb>, over: Data = {}) {
  db._set("mahjongCsEvents", "cs1", {
    ...create, csEventId: "cs1", seasonId: "s1", status: "entry",
    entryClosesAt: "2099-01-01T00:00:00Z", priorityUserIds: [],
    entries: [], entrants: [], rounds: [],
    createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
    ...over,
  });
}
const entry = (id: string, index: number, state = "confirmed") => ({
  lineUserId: id, displayName: id, tier: "M3", rank: 100000,
  enteredAt: `2026-10-01T00:0${index}:00Z`, state,
});

it.each([
  ["開始より前", "2026-09-30T00:00:00+09:00"],
  ["開始と同時", create.entryOpensAt],
])("updateEntry: 締切が%sなら 400", async (_, entryClosesAt) => {
  const db = makeDb(); entryEvent(db); (getDb as jest.Mock).mockReturnValue(db);
  const before = db._get("mahjongCsEvents", "cs1");
  const res = await PATCH(body({ action: "updateEntry", entryClosesAt }), params);
  expect(res.status).toBe(400);
  expect(db._get("mahjongCsEvents", "cs1")).toEqual(before);
});

it("updateEntry: 定員を下げると先着順で確定・キャンセル待ちを再配分する", async () => {
  const db = makeDb();
  entryEvent(db, { entries: ["a", "b", "c", "d", "e", "f"].map((id, i) => entry(id, i)) });
  (getDb as jest.Mock).mockReturnValue(db);
  expect((await PATCH(body({ action: "updateEntry", capacity: 4 }), params)).status).toBe(200);
  const ev = db._get("mahjongCsEvents", "cs1");
  expect(ev.capacity).toBe(4);
  expect(ev.entries.map((e: { lineUserId: string; state: string }) => [e.lineUserId, e.state]))
    .toEqual([["a", "confirmed"], ["b", "confirmed"], ["c", "confirmed"], ["d", "confirmed"],
      ["e", "waitlisted"], ["f", "waitlisted"]]);
});

it("closeNow: 受付中なら締切を現在時刻にして参加者を確定し、未表明の優先枠を開放する", async () => {
  jest.useFakeTimers().setSystemTime(new Date("2026-10-05T00:00:00Z"));
  try {
    const db = makeDb();
    entryEvent(db, { capacity: 4, priorityUserIds: ["p1"], entries: [
      entry("a", 0), entry("b", 1), entry("c", 2), entry("d", 3, "waitlisted"),
      entry("e", 4, "waitlisted"),
    ] });
    (getDb as jest.Mock).mockReturnValue(db);
    expect((await PATCH(body({ action: "closeNow" }), params)).status).toBe(200);
    const ev = db._get("mahjongCsEvents", "cs1");
    expect(ev.status).toBe("closed");
    expect(ev.entryClosesAt).toBe("2026-10-05T00:00:00.000Z");
    expect(ev.entrants.map((e: { lineUserId: string }) => e.lineUserId)).toEqual(["a", "b", "c", "d"]);
    expect(ev.entries.find((e: { lineUserId: string }) => e.lineUserId === "d").state).toBe("confirmed");
    expect(ev.entries.find((e: { lineUserId: string }) => e.lineUserId === "e").state).toBe("waitlisted");
  } finally { jest.useRealTimers(); }
});

it("reopenBracket: closed に戻して実行ラウンドと優勝者を消し、編成は残す", async () => {
  const db = makeDb(); closedEvent(db);
  const bracket = { seedUserIds: ["a"], rounds: oneTable([P("a"), P("b"), P("c"), P("d")]) };
  db._set("mahjongCsEvents", "cs1", {
    ...db._get("mahjongCsEvents", "cs1"), status: "running", championId: "a", bracket,
    rounds: oneTable([P("a"), P("b"), P("c"), P("d")]),
  });
  (getDb as jest.Mock).mockReturnValue(db);
  expect((await PATCH(body({ action: "reopenBracket" }), params)).status).toBe(200);
  const ev = db._get("mahjongCsEvents", "cs1");
  expect(ev.status).toBe("closed");
  expect(ev.rounds).toEqual([]);
  expect(ev).not.toHaveProperty("championId");
  expect(ev.bracket).toEqual(bracket);
});

it("fillDummies: 非本番では既存参加者を残し demo_cs_1 から定員まで埋める", async () => {
  const db = makeDb(); entryEvent(db, { capacity: 4, entries: [entry("a", 0)] });
  (getDb as jest.Mock).mockReturnValue(db);
  expect((await PATCH(body({ action: "fillDummies" }), params)).status).toBe(200);
  const ev = db._get("mahjongCsEvents", "cs1");
  expect(ev.demoDummy).toBe(true);
  expect(ev.entries).toHaveLength(4);
  expect(ev.entries).toContainEqual(entry("a", 0));
  for (let i = 1; i <= 3; i++) {
    expect(ev.entries).toContainEqual(expect.objectContaining({
      lineUserId: `demo_cs_${i}`, displayName: `ダミー${i}`, tier: "M3", state: "confirmed",
    }));
  }
});

it("作成: entrants と rounds は空配列で永続化する", async () => {
  const db = makeDb(); withAssignment(db); (getDb as jest.Mock).mockReturnValue(db);
  const res = await POST(body(create));
  expect(res.status).toBe(201);
  const { event } = await res.json();
  expect(typeof event.csEventId).toBe("string");
  expect(event.csEventId.length).toBeGreaterThan(0);
  const stored = db._get("mahjongCsEvents", event.csEventId);
  expect(stored.entrants).toEqual([]);
  expect(stored.rounds).toEqual([]);
});

it.each(["updateEntry", "closeNow", "removeEntry", "saveBracket", "confirmBracket", "reopenBracket", "fillDummies"])(
  "旧方式: capacity のない doc への %s は 409", async (action) => {
    const db = makeDb();
    const legacy = { csEventId: "cs1", seasonId: "s1", status: "setup", entrants: [], rounds: [] };
    db._set("mahjongCsEvents", "cs1", legacy); (getDb as jest.Mock).mockReturnValue(db);
    const res = await PATCH(body({ action, capacity: 4, lineUserId: "a", seedUserIds: [],
      rounds: oneTable([P("a"), P("b"), P("c"), P("d")]) }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("旧形式のCSは変更できません");
    expect(db._get("mahjongCsEvents", "cs1")).toEqual(legacy);
  },
);

it.each([3, 5])("saveBracket: seats が %i 席なら 400", async (length) => {
  const db = makeDb(); closedEvent(db); (getDb as jest.Mock).mockReturnValue(db);
  const res = await PATCH(body({ action: "saveBracket", seedUserIds: [],
    rounds: oneTable(Array.from({ length }, () => null)) }), params);
  expect(res.status).toBe(400);
  expect(db._get("mahjongCsEvents", "cs1")).not.toHaveProperty("bracket");
});
