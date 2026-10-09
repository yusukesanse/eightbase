jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/adminAuth", () => ({ checkAdminAuth: jest.fn().mockResolvedValue("admin@example.com") }));
jest.mock("@/lib/mahjong", () => ({ getActiveSeason: jest.fn() }));
jest.mock("@/lib/auditLog", () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/env", () => ({ isProduction: jest.fn().mockReturnValue(false) }));
jest.mock("firebase-admin/firestore", () => {
  const deleteSentinel = Symbol("FieldValue.delete");
  return { FieldValue: { delete: jest.fn(() => deleteSentinel) } };
});

import { writeAuditLog } from "@/lib/auditLog";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { FieldValue, type DocumentData } from "firebase-admin/firestore";
import type { NextRequest } from "next/server";

type Data = Record<string, unknown>;

function makeDb() {
  const store = new Map<string, Map<string, Data>>();
  let nextId = 1;
  const transactionUpdates: Data[][] = [];
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
      const updates: Data[] = [];
      transactionUpdates.push(updates);
      const tx = {
        get: (ref: ReturnType<typeof docRef>) => ref.get(),
        set: (ref: ReturnType<typeof docRef>, d: Data, opt?: { merge?: boolean }) => {
          const cur = opt?.merge ? (col(ref.__c).get(ref.id) ?? {}) : {};
          col(ref.__c).set(ref.id, { ...cur, ...d });
        },
        update: (ref: ReturnType<typeof docRef>, d: Data) => {
          updates.push(d);
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
      doc: (id?: string) => {
        if (id === undefined) {
          do { id = `auto_${nextId++}`; } while (col(c).has(id));
        }
        return docRef(c, id);
      },
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
    transactionUpdates,
    // Match Firestore data() typing so the brief's assertions remain verbatim.
    _get: (c: string, id: string): DocumentData => store.get(c)!.get(id)!,
    _set: (c: string, id: string, d: Data) => col(c).set(id, d),
  };
}

jest.mock("@/lib/auth", () => ({ requireGameUser: jest.fn() }));
import { requireGameUser } from "@/lib/auth";
import { isProduction } from "@/lib/env";
import { POST } from "@/app/api/admin/mahjong/cs/[csEventId]/fix/route";
import { applyCompletedMatch } from "@/lib/mahjongCsBracket";
import type { MahjongCsMatchPlayer, MahjongCsRound } from "@/types";

beforeEach(() => {
  jest.clearAllMocks();
  (checkAdminAuth as jest.Mock).mockResolvedValue("admin@example.com");
  (isProduction as jest.Mock).mockReturnValue(false);
});

import { PATCH } from "@/app/api/mahjong/cs/match/route";
import { buildRunningRounds } from "@/lib/mahjongCsBracket";

const P = (id: string) => ({ kind: "player" as const, lineUserId: id });
const T = (m: string, p: number) => ({ kind: "ticket" as const, fromMatchId: m, place: p });
const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
const entrants = ids.map((id) => ({ lineUserId: id, displayName: id, rank: 100000, seed: false }));
const draft = [
  { type: "prelim" as const, label: "予選", advanceCount: 2, matches: [
    { matchId: "A", label: "予選A卓", players: [], status: "reporting" as const, seats: [P("a"), P("b"), P("c"), P("d")] },
    { matchId: "B", label: "予選B卓", players: [], status: "reporting" as const, seats: [P("e"), P("f"), P("g"), P("h")] },
  ] },
  { type: "final" as const, label: "決勝", advanceCount: 1, matches: [
    { matchId: "F", label: "決勝卓", players: [], status: "reporting" as const, seats: [T("A", 1), T("B", 1), T("A", 2), T("B", 2)] },
  ] },
];
function seed(db: ReturnType<typeof makeDb>) {
  db._set("mahjongCsEvents", "cs1", {
    csEventId: "cs1", seasonId: "s1", status: "running", capacity: 8, priorityUserIds: [],
    entrants, rounds: buildRunningRounds(draft, entrants), bracket: { seedUserIds: [], rounds: draft },
  });
}
const report = (id: string, matchId: string, points: number, rank: number) => {
  (requireGameUser as jest.Mock).mockResolvedValue(id);
  return PATCH({ json: async () => ({ csEventId: "cs1", matchId, points, rank }) } as unknown as NextRequest);
};

it("予選A卓の4人が申告し終えると、1位・2位が決勝卓の札の席に入る", async () => {
  const db = makeDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  await report("a", "A", 40000, 1); await report("b", "A", 30000, 2);
  await report("c", "A", 20000, 3); await report("d", "A", 10000, 4);
  const fin = db._get("mahjongCsEvents", "cs1").rounds[1].matches[0];
  expect(fin.players.map((p: { lineUserId: string }) => p.lineUserId).sort()).toEqual(["a", "b"]);
});

it("札の席が埋まっていない卓には申告できない（409）", async () => {
  const db = makeDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  await report("a", "A", 40000, 1); await report("b", "A", 30000, 2);
  await report("c", "A", 20000, 3); await report("d", "A", 10000, 4);
  expect((await report("a", "F", 40000, 1)).status).toBe(409);
});

it("決勝卓が確定したら finished と優勝者", async () => {
  const db = makeDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  const pts = [40000, 30000, 20000, 10000];
  for (const [i, id] of ["a", "b", "c", "d"].entries()) await report(id, "A", pts[i], i + 1);
  for (const [i, id] of ["e", "f", "g", "h"].entries()) await report(id, "B", pts[i], i + 1);
  for (const [i, id] of ["f", "a", "e", "b"].entries()) await report(id, "F", pts[i], i + 1);
  const ev = db._get("mahjongCsEvents", "cs1");
  expect(ev.status).toBe("finished");
  expect(ev.championId).toBe("f");
});

it("同卓でない人は申告できない（403）", async () => {
  const db = makeDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  expect((await report("e", "A", 40000, 1)).status).toBe(403);
});

const params = { params: Promise.resolve({ csEventId: "cs1" }) };
const fix = (body: Data) => POST({ json: async () => body } as unknown as NextRequest, params);
const results = (rankedIds: string[]) => rankedIds.map((lineUserId, i) => ({
  lineUserId, points: [40000, 30000, 20000, 10000][i], rank: i + 1,
}));

// Seed completed preliminaries independently of the PATCH behavior under test.
function seedCompletedPrelims(db: ReturnType<typeof makeDb>, matchIds = ["A", "B"]) {
  seed(db);
  let rounds = buildRunningRounds(draft, entrants);
  for (const [matchId, rankedIds] of [["A", ["a", "b", "c", "d"]], ["B", ["e", "f", "g", "h"]]] as const) {
    if (!matchIds.includes(matchId)) continue;
    const match = rounds[0].matches.find((m) => m.matchId === matchId)!;
    match.players = match.players.map((p, i) => ({ ...p, ...results([...rankedIds])[i] }));
    match.status = "completed";
    rounds = applyCompletedMatch(rounds, matchId, entrants).rounds;
  }
  db._set("mahjongCsEvents", "cs1", { ...db._get("mahjongCsEvents", "cs1"), rounds });
  (getDb as jest.Mock).mockReturnValue(db);
  return rounds;
}

it("editMatch: 予選Aだけ完了した2人の決勝卓は409で保存も監査ログも行わない", async () => {
  const db = makeDb(); seedCompletedPrelims(db, ["A"]);
  const before = structuredClone(db._get("mahjongCsEvents", "cs1"));
  expect(before.rounds[0].matches.map((m: { status: string }) => m.status)).toEqual(["completed", "reporting"]);
  expect(before.rounds[1].matches[0].players.map((p: MahjongCsMatchPlayer) => p.lineUserId)).toEqual(["a", "b"]);
  const res = await fix({ action: "editMatch", matchId: "F", results: results(["a", "b"]) });
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("この卓はまだ全員そろっていません");
  expect(db._get("mahjongCsEvents", "cs1")).toEqual(before);
  expect(db.transactionUpdates.flat()).toHaveLength(0);
  expect(writeAuditLog).not.toHaveBeenCalled();
});

it.each([
  { action: "resetBracket", status: "entry" },
  { action: "editMatch", status: "closed" },
])("fix $action: 新方式の$statusでは409で書き込まない", async ({ action, status }) => {
  const db = makeDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  db._set("mahjongCsEvents", "cs1", { ...db._get("mahjongCsEvents", "cs1"), status });
  const before = structuredClone(db._get("mahjongCsEvents", "cs1"));
  const res = await fix(action === "editMatch"
    ? { action, matchId: "A", results: results(["a", "b", "c", "d"]) }
    : { action });
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("現在の状態ではこの操作はできません");
  expect(db._get("mahjongCsEvents", "cs1")).toEqual(before);
  expect(db.transactionUpdates.flat()).toHaveLength(0);
  expect(writeAuditLog).not.toHaveBeenCalled();
});

it("editMatch: A卓の上位2人を入れ替えても決勝卓とラウンドを維持する", async () => {
  const db = makeDb(); seedCompletedPrelims(db);
  const res = await fix({ action: "editMatch", matchId: "A", results: results(["c", "d", "a", "b"]) });
  expect(res.status).toBe(200);
  const ev = db._get("mahjongCsEvents", "cs1");
  expect(ev.rounds).toHaveLength(2);
  expect(ev.rounds[1].matches[0]).toMatchObject({ matchId: "F", status: "reporting" });
  expect(ev.rounds[1].matches[0].players.map((p: MahjongCsMatchPlayer) => p.lineUserId))
    .toEqual(["c", "e", "d", "f"]);
});

it("editMatch: 決勝卓に申告が入った後のA卓修正は409", async () => {
  const db = makeDb();
  const rounds = seedCompletedPrelims(db);
  rounds[1].matches[0].players[0].points = 40000;
  rounds[1].matches[0].players[0].rank = 1;
  const res = await fix({ action: "editMatch", matchId: "A", results: results(["c", "d", "a", "b"]) });
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("次の卓に結果が入っているため修正できません。先に次の卓の結果を直すか、編成に戻してください");
  expect(db.transactionUpdates.flat()).toHaveLength(0);
  expect(writeAuditLog).not.toHaveBeenCalled();
});

it("editMatch: 決勝卓の修正で優勝者を付け直しfinishedにする", async () => {
  const db = makeDb();
  const rounds = seedCompletedPrelims(db);
  const final = rounds[1].matches[0];
  final.players = final.players.map((p, i) => ({ ...p, points: [40000, 30000, 20000, 10000][i], rank: i + 1 }));
  final.status = "completed";
  db._set("mahjongCsEvents", "cs1", { ...db._get("mahjongCsEvents", "cs1"), status: "finished", championId: "a" });
  const res = await fix({ action: "editMatch", matchId: "F", results: results(["f", "a", "e", "b"]) });
  expect(res.status).toBe(200);
  expect(db._get("mahjongCsEvents", "cs1")).toMatchObject({ status: "finished", championId: "f" });
});

it("resetBracket: 新方式はclosedに戻し編成を残して1回だけ更新する", async () => {
  const db = makeDb(); seedCompletedPrelims(db);
  db._set("mahjongCsEvents", "cs1", { ...db._get("mahjongCsEvents", "cs1"), status: "finished", championId: "a" });
  const bracket = structuredClone(db._get("mahjongCsEvents", "cs1").bracket);
  expect((await fix({ action: "resetBracket" })).status).toBe(200);
  const ev = db._get("mahjongCsEvents", "cs1");
  expect(db.transactionUpdates.map((updates) => updates.length)).toEqual([1]);
  expect(ev.status).toBe("closed");
  expect(ev.rounds).toEqual([]);
  expect(ev).not.toHaveProperty("championId");
  expect(ev.bracket).toEqual(bracket);
});

it("編成に戻したclosed・rounds空の新方式には申告できない", async () => {
  const db = makeDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  db._set("mahjongCsEvents", "cs1", { ...db._get("mahjongCsEvents", "cs1"), status: "closed", rounds: [] });
  const res = await report("a", "A", 40000, 1);
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("対戦はまだ始まっていません");
  expect(db.transactionUpdates.flat()).toHaveLength(0);
});

it("終了した新方式への申告は409で大会終了のエラーを返す", async () => {
  const db = makeDb(); seedCompletedPrelims(db);
  const res = await fix({ action: "editMatch", matchId: "F", results: results(["a", "e", "b", "f"]) });
  expect(res.status).toBe(200);
  const before = structuredClone(db._get("mahjongCsEvents", "cs1"));
  expect(before.status).toBe("finished");
  db.transactionUpdates.length = 0;
  const reportRes = await report("a", "F", 40000, 1);
  expect(reportRes.status).toBe(409);
  expect((await reportRes.json()).error).toBe("この大会は終了しています");
  expect(db._get("mahjongCsEvents", "cs1")).toEqual(before);
  expect(db.transactionUpdates.flat()).toHaveLength(0);
});

it("roundsが残っていてもclosedの新方式は開始前として409", async () => {
  const db = makeDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  db._set("mahjongCsEvents", "cs1", { ...db._get("mahjongCsEvents", "cs1"), status: "closed" });
  const res = await report("a", "A", 40000, 1);
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("対戦はまだ始まっていません");
  expect(db.transactionUpdates.flat()).toHaveLength(0);
});

it("予選完了前の4人未満の決勝卓は参加者判定より先に409", async () => {
  const db = makeDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  const res = await report("outsider", "F", 40000, 1);
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("この卓はまだ全員そろっていません");
  expect(db.transactionUpdates.flat()).toHaveLength(0);
});

it("デモのautoでA卓が確定すると上位2人が決勝卓へ進む", async () => {
  const db = makeDb(); seed(db); (getDb as jest.Mock).mockReturnValue(db);
  db._set("mahjongCsEvents", "cs1", { ...db._get("mahjongCsEvents", "cs1"), demoDummy: true });
  (requireGameUser as jest.Mock).mockResolvedValue("demo-operator");
  const res = await PATCH({ json: async () => ({ csEventId: "cs1", matchId: "A", auto: true }) } as unknown as NextRequest);
  expect(res.status).toBe(200);
  expect((await res.json()).completed).toBe(true);
  const ev = db._get("mahjongCsEvents", "cs1");
  expect(ev.rounds[0].matches[0].status).toBe("completed");
  expect(ev.rounds[1].matches[0].players.map((p: MahjongCsMatchPlayer) => p.lineUserId)).toEqual(["a", "b"]);
});

function seedLegacy(db: ReturnType<typeof makeDb>) {
  (getDb as jest.Mock).mockReturnValue(db);
  const rounds: MahjongCsRound[] = [{ type: "final", label: "決勝", advanceCount: 1, matches: [{
    matchId: "legacy-final", label: "決勝卓", status: "reporting",
    players: ["a", "b", "c", "d"].map((lineUserId) => ({ lineUserId, displayName: lineUserId, points: null, rank: null })),
  }] }];
  db._set("mahjongCsEvents", "cs1", { csEventId: "cs1", seasonId: "s1", status: "running", entrants: entrants.slice(0, 4), rounds });
}

it.each(["新方式", "旧方式"])("editMatch: %sの100点単位でない点数は400", async (format) => {
  const db = makeDb();
  if (format === "新方式") {
    seed(db); (getDb as jest.Mock).mockReturnValue(db);
  } else {
    seedLegacy(db);
  }
  const before = structuredClone(db._get("mahjongCsEvents", "cs1"));
  // Keep the total and ranking valid so only the 100-point increment is invalid.
  const invalidResults = results(["a", "b", "c", "d"]).map((r, i) => ({
    ...r, points: [40000, 30000, 25050, 4950][i],
  }));
  const res = await fix({ action: "editMatch", matchId: format === "新方式" ? "A" : "legacy-final", results: invalidResults });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("点数は100点単位の整数で入力してください");
  expect(db._get("mahjongCsEvents", "cs1")).toEqual(before);
  expect(db.transactionUpdates.flat()).toHaveLength(0);
  expect(writeAuditLog).not.toHaveBeenCalled();
});

it("resetBracket: 旧方式はsetupとchampionId nullを保存してcs.resetを記録する", async () => {
  const db = makeDb(); seedLegacy(db);
  db._set("mahjongCsEvents", "cs1", { ...db._get("mahjongCsEvents", "cs1"), status: "finished", championId: "a" });
  const res = await fix({ action: "resetBracket" });
  expect(res.status).toBe(200);
  expect(db.transactionUpdates.map((updates) => updates.length)).toEqual([1]);
  expect(db.transactionUpdates.flat()[0]).toMatchObject({ status: "setup", championId: null, rounds: [] });
  expect(db._get("mahjongCsEvents", "cs1")).toMatchObject({ status: "setup", championId: null, rounds: [] });
  expect(writeAuditLog).toHaveBeenCalledTimes(1);
  expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ eventType: "cs.reset" }));
});

it("旧方式は4人全員の自己申告でfinishedと1位の優勝者を保存する", async () => {
  const db = makeDb(); seedLegacy(db);
  for (const r of results(["d", "b", "c", "a"])) {
    expect((await report(r.lineUserId, "legacy-final", r.points, r.rank)).status).toBe(200);
  }
  expect(db._get("mahjongCsEvents", "cs1")).toMatchObject({ status: "finished", championId: "d" });
  expect(db._get("mahjongCsEvents", "cs1").rounds[0].matches[0].status).toBe("completed");
});
