/**
 * 単体テスト: src/lib/billiardsDay.ts の当日進行（試合ログ方式・In-memory Firestore モック）。
 * 麻雀 mahjongDay / ダーツ dartsDayTx と対称の当日フロー検証（従来ここだけ欠落していた）。
 *
 * - start: 開始前に確定済みのエントリーを participants に確定・受付締切・冪等・最少人数・中止/非開催ガード
 * - log/delete: 試合ログの追加/取消と入力検証（勝者=敗者・非参加者・玉数範囲・終了後拒否）
 * - computeBilliardsDayScores: 勝者14pt/敗者=玉数の集計と当日順位（純関数）
 * - finish: 当日集計を scores/games に書き finishedAt を打刻・冪等
 * - cancel: 支払い済みは返金対象化・reserved/lock削除・dayState破棄・通知・終了済みは中止不可
 *
 * モックは transaction / batch を逐次実行する（真の並行性は無いが不変条件は検証できる）。
 */

jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/billiardsSchedule", () => ({
  isScheduledBilliardsDate: jest.fn().mockResolvedValue(true),
  isBilliardsCancelledDate: jest.fn().mockResolvedValue(false),
}));
jest.mock("@/lib/adminNotify", () => ({ notifyAdmin: jest.fn().mockResolvedValue(undefined) }));

import { getDb } from "@/lib/firebaseAdmin";
import { notifyAdmin } from "@/lib/adminNotify";
import {
  startBilliardsDay,
  logBilliardsMatch,
  deleteBilliardsMatch,
  computeBilliardsDayScores,
  finishBilliardsDay,
  cancelBilliardsDay,
} from "@/lib/billiardsDay";
import {
  BILLIARDS_MIN_PARTICIPANTS,
  BILLIARDS_WINNER_POINTS,
  BILLIARDS_MAX_LOSER_BALLS,
  type BilliardsDayState,
} from "@/types/billiards";

/* ───────── In-memory Firestore モック（transaction + batch） ───────── */
type Data = Record<string, unknown>;
type Ref = { __c: string; id: string };
type Opts = { merge?: boolean };
function makeDb() {
  const store = new Map<string, Map<string, Data>>();
  const col = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name)!;
  };
  const mutate = {
    set: (c: string, id: string, data: Data, merge?: boolean) => {
      const cur = col(c).get(id);
      col(c).set(id, merge ? { ...(cur ?? {}), ...data } : { ...data });
    },
    create: (c: string, id: string, data: Data) => {
      if (col(c).has(id)) throw new Error("ALREADY_EXISTS");
      col(c).set(id, { ...data });
    },
    update: (c: string, id: string, data: Data) => col(c).set(id, { ...(col(c).get(id) ?? {}), ...data }),
    delete: (c: string, id: string) => col(c).delete(id),
  };
  const docRef = (c: string, id: string) => ({
    __c: c,
    id,
    get: async () => ({ exists: col(c).has(id), id, data: () => col(c).get(id) }),
    set: async (d: Data, o?: Opts) => mutate.set(c, id, d, o?.merge),
    create: async (d: Data) => mutate.create(c, id, d),
    update: async (d: Data) => mutate.update(c, id, d),
    delete: async () => mutate.delete(c, id),
  });
  const runQuery = (c: string, filters: [string, unknown][]) => {
    const docs = Array.from(col(c).entries())
      .filter(([, data]) => filters.every(([f, v]) => data[f] === v))
      .map(([id, data]) => ({ id, data: () => data }));
    return { docs, size: docs.length, empty: docs.length === 0 };
  };
  const query = (c: string, filters: [string, unknown][]) => ({
    __c: c,
    __filters: filters,
    where: (f: string, _op: string, v: unknown) => query(c, [...filters, [f, v]]),
    limit: () => query(c, filters),
    get: async () => runQuery(c, filters),
  });
  const tx = {
    get: async (ref: { __filters?: [string, unknown][]; __c: string; get?: () => Promise<unknown> }) => {
      if (ref.__filters !== undefined) return runQuery(ref.__c, ref.__filters);
      return (ref as { get: () => Promise<unknown> }).get();
    },
    set: (ref: Ref, d: Data, o?: Opts) => mutate.set(ref.__c, ref.id, d, o?.merge),
    create: (ref: Ref, d: Data) => mutate.create(ref.__c, ref.id, d),
    update: (ref: Ref, d: Data) => mutate.update(ref.__c, ref.id, d),
    delete: (ref: Ref) => mutate.delete(ref.__c, ref.id),
  };
  const batch = () => {
    const ops: (() => void)[] = [];
    return {
      set: (ref: Ref, d: Data, o?: Opts) => ops.push(() => mutate.set(ref.__c, ref.id, d, o?.merge)),
      update: (ref: Ref, d: Data) => ops.push(() => mutate.update(ref.__c, ref.id, d)),
      delete: (ref: Ref) => ops.push(() => mutate.delete(ref.__c, ref.id)),
      commit: async () => ops.forEach((f) => f()),
    };
  };
  return {
    collection: (name: string) => ({
      doc: (id: string) => docRef(name, id),
      where: (f: string, _op: string, v: unknown) => query(name, [[f, v]]),
    }),
    runTransaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
    batch,
    __store: store,
  };
}

let db: ReturnType<typeof makeDb>;
const SEASON = "s1";
const DATE = "2026-07-11";
const MONTH = "2026-07";

beforeEach(() => {
  db = makeDb();
  (getDb as jest.Mock).mockReturnValue(db);
  (notifyAdmin as jest.Mock).mockClear();
  const sched = jest.requireMock("@/lib/billiardsSchedule");
  sched.isScheduledBilliardsDate.mockResolvedValue(true);
  sched.isBilliardsCancelledDate.mockResolvedValue(false);
});

function seedPaidEntry(uid: string, i: number, orderId: string | null = `ord-${uid}`) {
  const c = db.__store.get("billiardsEntries") ?? new Map();
  db.__store.set("billiardsEntries", c);
  c.set(`${SEASON}_${DATE}_${uid}`, {
    seasonId: SEASON,
    eventDate: DATE,
    lineUserId: uid,
    displayName: uid.toUpperCase(),
    status: "paid",
    paymentStatus: "paid",
    paymentTransactionId: orderId,
    paymentAmount: 1500,
    enteredAt: `2026-07-11T09:0${i}:00.000Z`,
  });
}
function seedReservedEntry(uid: string, i: number) {
  const c = db.__store.get("billiardsEntries") ?? new Map();
  db.__store.set("billiardsEntries", c);
  c.set(`${SEASON}_${DATE}_${uid}`, {
    seasonId: SEASON,
    eventDate: DATE,
    lineUserId: uid,
    displayName: uid.toUpperCase(),
    status: "reserved",
    enteredAt: `2026-07-11T09:1${i}:00.000Z`,
  });
}
const dayDoc = () => db.__store.get("billiardsDayState")?.get(`${SEASON}_${DATE}`) as BilliardsDayState | undefined;
const writeDay = (d: BilliardsDayState) =>
  db.__store.get("billiardsDayState")!.set(`${SEASON}_${DATE}`, d as unknown as Data);

async function started(members: string[] = ["a", "b", "c", "d"]) {
  members.forEach((u, i) => seedPaidEntry(u, i));
  await startBilliardsDay(SEASON, DATE, "gm");
}

/* ───────── start ───────── */
describe("startBilliardsDay", () => {
  test("開始前に確定済みのエントリーは participants に入り、受付を締め切る", async () => {
    ["a", "b"].forEach((u, i) => seedPaidEntry(u, i));
    const r = await startBilliardsDay(SEASON, DATE, "gm");
    expect(r).toMatchObject({ ok: true, already: false, paidCount: 2 });
    expect(dayDoc()?.participants.map((p) => p.lineUserId).sort()).toEqual(["a", "b"]);
    expect(dayDoc()?.entryClosedAt).toBeTruthy();
    expect(dayDoc()?.startedBy).toBe("gm");
    expect(dayDoc()?.matches).toEqual([]);
  });

  test(`最少人数(${BILLIARDS_MIN_PARTICIPANTS})未満は開始しない`, async () => {
    seedPaidEntry("a", 0);
    const r = await startBilliardsDay(SEASON, DATE, "gm");
    expect(r.ok).toBe(false);
    expect(dayDoc()).toBeUndefined();
  });

  test("reserved（未払い）は participants に含めない", async () => {
    seedPaidEntry("a", 0);
    seedPaidEntry("b", 1);
    seedReservedEntry("c", 0);
    await startBilliardsDay(SEASON, DATE, "gm");
    expect(dayDoc()?.participants.map((p) => p.lineUserId).sort()).toEqual(["a", "b"]);
  });

  test("二重開始は冪等成功", async () => {
    ["a", "b"].forEach((u, i) => seedPaidEntry(u, i));
    await startBilliardsDay(SEASON, DATE, "gm");
    const r2 = await startBilliardsDay(SEASON, DATE, "gm");
    expect(r2).toMatchObject({ ok: true, already: true });
  });

  test("非開催日は開始できない", async () => {
    ["a", "b"].forEach((u, i) => seedPaidEntry(u, i));
    jest.requireMock("@/lib/billiardsSchedule").isScheduledBilliardsDate.mockResolvedValue(false);
    const r = await startBilliardsDay(SEASON, DATE, "gm");
    expect(r.ok).toBe(false);
  });

  test("中止確定済みの日は開始できない", async () => {
    ["a", "b"].forEach((u, i) => seedPaidEntry(u, i));
    jest.requireMock("@/lib/billiardsSchedule").isBilliardsCancelledDate.mockResolvedValue(true);
    const r = await startBilliardsDay(SEASON, DATE, "gm");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/中止/);
  });
});

/* ───────── log / delete ───────── */
describe("logBilliardsMatch", () => {
  test("正常な試合を記録する", async () => {
    await started();
    const r = await logBilliardsMatch(SEASON, DATE, "gm", { winnerId: "a", loserId: "b", loserBalls: 3 });
    expect(r.ok).toBe(true);
    expect(dayDoc()?.matches).toHaveLength(1);
    expect(dayDoc()?.matches[0]).toMatchObject({ winnerId: "a", loserId: "b", loserBalls: 3, createdBy: "gm" });
  });

  test("勝者と敗者が同一なら拒否", async () => {
    await started();
    const r = await logBilliardsMatch(SEASON, DATE, "gm", { winnerId: "a", loserId: "a", loserBalls: 2 });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  test("参加者以外は記録できない", async () => {
    await started();
    const r = await logBilliardsMatch(SEASON, DATE, "gm", { winnerId: "a", loserId: "zzz", loserBalls: 2 });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  test(`玉数が範囲外(> ${BILLIARDS_MAX_LOSER_BALLS})は拒否`, async () => {
    await started();
    const r = await logBilliardsMatch(SEASON, DATE, "gm", { winnerId: "a", loserId: "b", loserBalls: BILLIARDS_MAX_LOSER_BALLS + 1 });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  test("玉数が負・非整数は拒否", async () => {
    await started();
    expect(await logBilliardsMatch(SEASON, DATE, "gm", { winnerId: "a", loserId: "b", loserBalls: -1 })).toMatchObject({ ok: false, status: 400 });
    expect(await logBilliardsMatch(SEASON, DATE, "gm", { winnerId: "a", loserId: "b", loserBalls: 1.5 })).toMatchObject({ ok: false, status: 400 });
  });

  test("未開始（dayState無し）は記録できない", async () => {
    const r = await logBilliardsMatch(SEASON, DATE, "gm", { winnerId: "a", loserId: "b", loserBalls: 2 });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  test("終了後は記録できない（409）", async () => {
    await started();
    writeDay({ ...(dayDoc() as BilliardsDayState), finishedAt: "2026-07-11T12:00:00.000Z" });
    const r = await logBilliardsMatch(SEASON, DATE, "gm", { winnerId: "a", loserId: "b", loserBalls: 2 });
    expect(r).toMatchObject({ ok: false, status: 409 });
  });
});

describe("deleteBilliardsMatch", () => {
  test("記録済みの試合を取り消す", async () => {
    await started();
    await logBilliardsMatch(SEASON, DATE, "gm", { winnerId: "a", loserId: "b", loserBalls: 3 });
    const mid = dayDoc()!.matches[0].matchId;
    const r = await deleteBilliardsMatch(SEASON, DATE, mid);
    expect(r.ok).toBe(true);
    expect(dayDoc()?.matches).toHaveLength(0);
  });

  test("存在しない試合IDは404", async () => {
    await started();
    const r = await deleteBilliardsMatch(SEASON, DATE, "nope");
    expect(r).toMatchObject({ ok: false, status: 404 });
  });

  test("終了後は取り消せない（409）", async () => {
    await started();
    await logBilliardsMatch(SEASON, DATE, "gm", { winnerId: "a", loserId: "b", loserBalls: 3 });
    const mid = dayDoc()!.matches[0].matchId;
    writeDay({ ...(dayDoc() as BilliardsDayState), finishedAt: "2026-07-11T12:00:00.000Z" });
    const r = await deleteBilliardsMatch(SEASON, DATE, mid);
    expect(r).toMatchObject({ ok: false, status: 409 });
  });
});

/* ───────── computeBilliardsDayScores（純関数） ───────── */
describe("computeBilliardsDayScores", () => {
  function buildDay(matches: { winnerId: string; loserId: string; loserBalls: number }[]): BilliardsDayState {
    return {
      seasonId: SEASON,
      eventDate: DATE,
      participants: ["a", "b", "c"].map((id) => ({ lineUserId: id, displayName: id.toUpperCase() })),
      entryClosedAt: "2026-07-11T09:00:00.000Z",
      startedBy: "gm",
      matches: matches.map((m, i) => ({ matchId: `m${i}`, ...m, createdAt: "x", createdBy: "gm" })),
      finishedAt: null,
      finishedBy: null,
      updatedAt: "2026-07-11T10:00:00.000Z",
    };
  }

  test("勝者は14pt、敗者は玉数、当日順位が付く", async () => {
    // a が b(玉3) と c(玉1) に勝つ → a=28, b=3, c=1
    const scores = computeBilliardsDayScores(buildDay([
      { winnerId: "a", loserId: "b", loserBalls: 3 },
      { winnerId: "a", loserId: "c", loserBalls: 1 },
    ]));
    const by = Object.fromEntries(scores.map((s) => [s.lineUserId, s]));
    expect(by.a.totalScore).toBe(BILLIARDS_WINNER_POINTS * 2);
    expect(by.b.totalScore).toBe(3);
    expect(by.c.totalScore).toBe(1);
    expect(by.a.details.wins).toBe(2);
    expect(by.a.details.losses).toBe(0);
    expect(by.b.details.losses).toBe(1);
    expect(by.a.details.dayRank).toBe(1);
    // b(3pt) は c(1pt) より上位
    expect(by.b.details.dayRank).toBeLessThan(by.c.details.dayRank);
  });

  test("試合ゼロなら全員0pt", async () => {
    const scores = computeBilliardsDayScores(buildDay([]));
    expect(scores.every((s) => s.totalScore === 0)).toBe(true);
  });
});

/* ───────── finish ───────── */
describe("finishBilliardsDay", () => {
  test("当日集計を scores/games に書き、finishedAt を打刻する", async () => {
    await started(["a", "b"]);
    await logBilliardsMatch(SEASON, DATE, "gm", { winnerId: "a", loserId: "b", loserBalls: 5 });
    const r = await finishBilliardsDay(SEASON, DATE, "gm");
    expect(r).toMatchObject({ ok: true, already: false, participantCount: 2 });
    expect(dayDoc()?.finishedAt).toBeTruthy();
    expect(dayDoc()?.finishedBy).toBe("gm");

    const gameId = `billiards-${SEASON}-${DATE}`;
    expect(db.__store.get("games")?.get(gameId)).toMatchObject({ gameCategory: "billiards", scoreRegistered: true });
    const sa = db.__store.get("scores")?.get(`${gameId}-a`) as Data;
    const sb = db.__store.get("scores")?.get(`${gameId}-b`) as Data;
    expect(sa.totalScore).toBe(BILLIARDS_WINNER_POINTS);
    expect(sb.totalScore).toBe(5);
    expect(sa.yearMonth).toBe(MONTH);
    expect(sa.recordedBy).toBe("gm:gm");
  });

  test("二重終了は冪等（already）", async () => {
    await started(["a", "b"]);
    await finishBilliardsDay(SEASON, DATE, "gm");
    const r2 = await finishBilliardsDay(SEASON, DATE, "gm");
    expect(r2).toMatchObject({ ok: true, already: true });
  });

  test("未開始は終了できない（400）", async () => {
    const r = await finishBilliardsDay(SEASON, DATE, "gm");
    expect(r).toMatchObject({ ok: false, status: 400 });
  });
});

/* ───────── cancel ───────── */
describe("cancelBilliardsDay", () => {
  test("支払い済みは返金対象・reserved/lock削除・dayState破棄・通知・中止doc作成", async () => {
    seedPaidEntry("a", 0);
    seedPaidEntry("b", 1);
    seedReservedEntry("c", 0);
    const locks = new Map<string, Data>([[`${SEASON}_a_${MONTH}`, { eventDate: DATE }]]);
    db.__store.set("billiardsMonthlyLocks", locks);
    await startBilliardsDay(SEASON, DATE, "gm");

    const r = await cancelBilliardsDay(SEASON, DATE, "gm");
    expect(r).toMatchObject({ status: "forfeited", paidCount: 2, refundCount: 2 });

    const a = db.__store.get("billiardsEntries")!.get(`${SEASON}_${DATE}_a`)!;
    expect(a.status).toBe("cancelRequested");
    expect(a.cancelReason).toBe("forfeit");
    // reserved 削除
    expect(db.__store.get("billiardsEntries")!.has(`${SEASON}_${DATE}_c`)).toBe(false);
    // lock 削除
    expect(db.__store.get("billiardsMonthlyLocks")!.has(`${SEASON}_a_${MONTH}`)).toBe(false);
    // dayState 破棄
    expect(dayDoc()).toBeUndefined();
    // 中止doc・通知
    expect(db.__store.get("billiardsCancelledDates")!.has(DATE)).toBe(true);
    expect((notifyAdmin as jest.Mock).mock.calls[0][0]).toBe("billiards_event_forfeit");
  });

  test("注文IDのない支払い済みは返金対象に数えない", async () => {
    seedPaidEntry("a", 0, null); // orderId 無し
    seedPaidEntry("b", 1);
    const r = await cancelBilliardsDay(SEASON, DATE, "gm");
    expect(r).toMatchObject({ status: "forfeited", paidCount: 2, refundCount: 1 });
  });

  test("二重中止は冪等（already）", async () => {
    seedPaidEntry("a", 0);
    seedPaidEntry("b", 1);
    await cancelBilliardsDay(SEASON, DATE, "gm");
    const r2 = await cancelBilliardsDay(SEASON, DATE, "gm");
    expect(r2).toEqual({ status: "already" });
  });

  test("終了済みは中止できない（finished）・中止docも作らない", async () => {
    await started(["a", "b"]);
    writeDay({ ...(dayDoc() as BilliardsDayState), finishedAt: "2026-07-11T12:00:00.000Z" });
    const r = await cancelBilliardsDay(SEASON, DATE, "gm");
    expect(r).toEqual({ status: "finished" });
    expect(db.__store.get("billiardsCancelledDates")?.has(DATE)).toBeFalsy();
  });
});
