/**
 * 単体テスト（再発防止）: dartsDay の transaction 系（In-memory Firestore モック）。
 * - Issue 1: start は tx 内でエントリーを読み参加者確定（開始前に確定済みのエントリーは participants に入る）
 * - Issue 4: cancel は tx 化（冪等・終了済み検知・返金対象化・reserved/lock削除・通知の永続doc）
 * - Issue 5: ゼロワン種別変更で途中申告をリセット
 * - Issue 6: 危険キーの申告拒否
 * - 状態機械: pending 種目/非参加者/終了後の申告拒否・GM代理
 *
 * モックは transaction を逐次実行する（真の並行性は無いが、「開始/中止が先に確定した後」の不変条件を検証できる）。
 */

jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/dartsSchedule", () => ({
  isScheduledDartsDate: jest.fn().mockResolvedValue(true),
  isDartsCancelledDate: jest.fn().mockResolvedValue(false),
}));

import { getDb } from "@/lib/firebaseAdmin";
import {
  startDartsDay,
  cancelDartsDay,
  setZeroOneVariant,
  reportDartsScore,
  confirmDartsEvent,
} from "@/lib/dartsDay";
import type { DartsDayState } from "@/types/darts";

/* ───────── In-memory Firestore モック ───────── */
type Data = Record<string, unknown>;
function makeDb() {
  const store = new Map<string, Map<string, Data>>();
  let auto = 0;
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
  const docRef = (c: string, id?: string) => {
    const _id = id ?? `auto${++auto}`;
    return {
      __c: c,
      id: _id,
      get: async () => ({ exists: col(c).has(_id), id: _id, data: () => col(c).get(_id) }),
      set: async (d: Data, o?: { merge?: boolean }) => mutate.set(c, _id, d, o?.merge),
      create: async (d: Data) => mutate.create(c, _id, d),
      update: async (d: Data) => mutate.update(c, _id, d),
      delete: async () => mutate.delete(c, _id),
    };
  };
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
    set: (ref: { __c: string; id: string }, d: Data, o?: { merge?: boolean }) => mutate.set(ref.__c, ref.id, d, o?.merge),
    create: (ref: { __c: string; id: string }, d: Data) => mutate.create(ref.__c, ref.id, d),
    update: (ref: { __c: string; id: string }, d: Data) => mutate.update(ref.__c, ref.id, d),
    delete: (ref: { __c: string; id: string }) => mutate.delete(ref.__c, ref.id),
  };
  return {
    collection: (name: string) => ({
      doc: (id?: string) => docRef(name, id),
      where: (f: string, _op: string, v: unknown) => query(name, [[f, v]]),
    }),
    runTransaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
    __store: store,
  };
}

let db: ReturnType<typeof makeDb>;
const SEASON = "s1";
const DATE = "2026-07-16";
beforeEach(() => {
  db = makeDb();
  (getDb as jest.Mock).mockReturnValue(db);
});

/** paid エントリーを直接投入。 */
function seedPaidEntry(uid: string, i: number, orderId: string | null = `ord-${uid}`) {
  db.__store.set("dartsEntries", db.__store.get("dartsEntries") ?? new Map());
  db.__store.get("dartsEntries")!.set(`${SEASON}_${DATE}_${uid}`, {
    seasonId: SEASON, eventDate: DATE, lineUserId: uid, displayName: uid.toUpperCase(),
    status: "paid", paymentStatus: "paid", paymentTransactionId: orderId,
    paymentAmount: 500, enteredAt: `2026-07-16T09:0${i}:00.000Z`,
  });
}
function seedReservedEntry(uid: string, i: number) {
  db.__store.set("dartsEntries", db.__store.get("dartsEntries") ?? new Map());
  db.__store.get("dartsEntries")!.set(`${SEASON}_${DATE}_${uid}`, {
    seasonId: SEASON, eventDate: DATE, lineUserId: uid, displayName: uid.toUpperCase(),
    status: "reserved", enteredAt: `2026-07-16T09:1${i}:00.000Z`,
  });
}
const dayDoc = () => db.__store.get("dartsDayState")?.get(`${SEASON}_${DATE}`) as DartsDayState | undefined;
// テストの異種ストア（Record<string,unknown>）へ dayState を書き戻すヘルパー。
const writeDay = (d: DartsDayState) =>
  db.__store.get("dartsDayState")!.set(`${SEASON}_${DATE}`, d as unknown as Record<string, unknown>);

describe("startDartsDay（Issue 1）", () => {
  test("開始前に確定済みのエントリーは participants に入る", async () => {
    ["a", "b", "c", "d"].forEach((u, i) => seedPaidEntry(u, i));
    const r = await startDartsDay(SEASON, DATE, "gm");
    expect(r).toMatchObject({ ok: true, already: false, paidCount: 4 });
    expect(dayDoc()?.participants.map((p) => p.lineUserId).sort()).toEqual(["a", "b", "c", "d"]);
    expect(dayDoc()?.entryClosedAt).toBeTruthy();
  });

  test("4名未満は開始しない", async () => {
    ["a", "b"].forEach((u, i) => seedPaidEntry(u, i));
    const r = await startDartsDay(SEASON, DATE, "gm");
    expect(r.ok).toBe(false);
  });

  test("二重開始は冪等成功", async () => {
    ["a", "b", "c", "d"].forEach((u, i) => seedPaidEntry(u, i));
    await startDartsDay(SEASON, DATE, "gm");
    const r2 = await startDartsDay(SEASON, DATE, "gm");
    expect(r2).toMatchObject({ ok: true, already: true });
  });

  test("中止確定後は開始できない", async () => {
    ["a", "b", "c", "d"].forEach((u, i) => seedPaidEntry(u, i));
    db.__store.set("dartsCancelledDates", new Map([[DATE, { eventDate: DATE }]]));
    const r = await startDartsDay(SEASON, DATE, "gm");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/中止/);
  });
});

describe("cancelDartsDay（Issue 4）", () => {
  test("支払い済みは返金対象・reserved と lock は削除・通知doc作成・dayState破棄", async () => {
    ["a", "b"].forEach((u, i) => seedPaidEntry(u, i));
    seedReservedEntry("c", 0);
    db.__store.set("dartsMonthlyLocks", new Map([[`${SEASON}_a_2026-07`, { eventDate: DATE }]]));
    // 開始しておく（dayState 存在）
    await startDartsDay(SEASON, DATE, "gm");

    const r = await cancelDartsDay(SEASON, DATE, "gm");
    expect(r).toMatchObject({ status: "forfeited", paidCount: 2, refundCount: 2 });
    // 支払い済み → cancelRequested + forfeit
    const a = db.__store.get("dartsEntries")!.get(`${SEASON}_${DATE}_a`)!;
    expect(a.status).toBe("cancelRequested");
    expect(a.cancelReason).toBe("forfeit");
    // reserved 削除
    expect(db.__store.get("dartsEntries")!.has(`${SEASON}_${DATE}_c`)).toBe(false);
    // lock 削除
    expect(db.__store.get("dartsMonthlyLocks")!.has(`${SEASON}_a_2026-07`)).toBe(false);
    // dayState 破棄
    expect(dayDoc()).toBeUndefined();
    // 通知 doc（永続）
    const notifs = Array.from((db.__store.get("adminNotifications") ?? new Map()).values());
    expect(notifs.some((n) => (n as Data).type === "darts_event_forfeit")).toBe(true);
    // 中止doc
    expect(db.__store.get("dartsCancelledDates")!.has(DATE)).toBe(true);
  });

  test("決済リンク発行済み(in-flight)の reserved は削除しない・注文なしは削除", async () => {
    // in-flight: reserved だが paymentTransactionId あり（決済が後から成立し得る）。
    db.__store.set("dartsEntries", db.__store.get("dartsEntries") ?? new Map());
    db.__store.get("dartsEntries")!.set(`${SEASON}_${DATE}_x`, {
      seasonId: SEASON, eventDate: DATE, lineUserId: "x", displayName: "X",
      status: "reserved", paymentStatus: "pending", paymentTransactionId: "ord-x",
      enteredAt: "2026-07-16T09:20:00.000Z",
    });
    seedReservedEntry("y", 5); // 注文なし
    seedPaidEntry("a", 0); seedPaidEntry("b", 1);
    await cancelDartsDay(SEASON, DATE, "gm");
    // in-flight は残る（complete が返金待ちにできるように）
    expect(db.__store.get("dartsEntries")!.has(`${SEASON}_${DATE}_x`)).toBe(true);
    // 注文なし reserved は削除
    expect(db.__store.get("dartsEntries")!.has(`${SEASON}_${DATE}_y`)).toBe(false);
  });

  test("二重中止は冪等成功（already）", async () => {
    ["a", "b"].forEach((u, i) => seedPaidEntry(u, i));
    await cancelDartsDay(SEASON, DATE, "gm");
    const r2 = await cancelDartsDay(SEASON, DATE, "gm");
    expect(r2).toEqual({ status: "already" });
  });

  test("終了済みは中止できない（finished）・中止docも作らない", async () => {
    ["a", "b", "c", "d"].forEach((u, i) => seedPaidEntry(u, i));
    await startDartsDay(SEASON, DATE, "gm");
    writeDay({ ...(dayDoc() as DartsDayState), finishedAt: "2026-07-16T12:00:00.000Z" });
    const r = await cancelDartsDay(SEASON, DATE, "gm");
    expect(r).toEqual({ status: "finished" });
    expect(db.__store.get("dartsCancelledDates")?.has(DATE)).toBeFalsy();
  });
});

describe("setZeroOneVariant（Issue 5）", () => {
  async function started() {
    ["a", "b", "c", "d"].forEach((u, i) => seedPaidEntry(u, i));
    await startDartsDay(SEASON, DATE, "gm");
  }
  test("種別変更で途中申告をリセット", async () => {
    await started();
    await setZeroOneVariant(SEASON, DATE, { start: 301, out: "double" });
    // ゼロワンに途中申告を入れる
    const day = dayDoc() as DartsDayState;
    day.events.find((e) => e.kind === "zeroOne")!.reports = { a: { value: 250, reportedAt: "x" } };
    writeDay(day);
    // 元数を変更 → リセット
    await setZeroOneVariant(SEASON, DATE, { start: 101, out: "double" });
    expect(dayDoc()?.events.find((e) => e.kind === "zeroOne")?.reports).toEqual({});
    expect(dayDoc()?.zeroOneVariant).toEqual({ start: 101, out: "double" });
  });
  test("同じ種別なら申告を保持", async () => {
    await started();
    await setZeroOneVariant(SEASON, DATE, { start: 301, out: "double" });
    const day = dayDoc() as DartsDayState;
    day.events.find((e) => e.kind === "zeroOne")!.reports = { a: { value: 250, reportedAt: "x" } };
    writeDay(day);
    await setZeroOneVariant(SEASON, DATE, { start: 301, out: "double" });
    expect(dayDoc()?.events.find((e) => e.kind === "zeroOne")?.reports).toEqual({ a: { value: 250, reportedAt: "x" } });
  });
});

describe("reportDartsScore（状態機械・Issue 6）", () => {
  async function started() {
    ["a", "b", "c", "d"].forEach((u, i) => seedPaidEntry(u, i));
    await startDartsDay(SEASON, DATE, "gm");
    await setZeroOneVariant(SEASON, DATE, { start: 301, out: "double" });
  }
  test("pending 種目（countUp）への申告は拒否", async () => {
    await started();
    const r = await reportDartsScore(SEASON, DATE, "a", "countUp", 400, { isGm: false });
    expect(r).toMatchObject({ ok: false, status: 409 });
  });
  test("非参加者の申告は拒否", async () => {
    await started();
    const r = await reportDartsScore(SEASON, DATE, "zzz", "zeroOne", 100, { isGm: false });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });
  test("非GMの代理申告は拒否", async () => {
    await started();
    const r = await reportDartsScore(SEASON, DATE, "a", "zeroOne", 100, { isGm: false, targetUserId: "b" });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });
  test("GM代理は成功", async () => {
    await started();
    const r = await reportDartsScore(SEASON, DATE, "gm", "zeroOne", 100, { isGm: true, targetUserId: "b" });
    expect(r.ok).toBe(true);
    expect(dayDoc()?.events.find((e) => e.kind === "zeroOne")?.reports.b?.value).toBe(100);
  });
  test("終了後は全変更拒否", async () => {
    await started();
    writeDay({ ...(dayDoc() as DartsDayState), finishedAt: "2026-07-16T12:00:00.000Z" });
    const r = await reportDartsScore(SEASON, DATE, "a", "zeroOne", 100, { isGm: false });
    expect(r).toMatchObject({ ok: false, status: 409 });
  });
  test("危険な teamId のクリケット申告を拒否（Issue 6）", async () => {
    await started();
    // 危険な teamId を持つ dayState を直接作る（validateを迂回した不正データ想定）
    const day = dayDoc() as DartsDayState;
    day.cricketTeams = [{ teamId: "__proto__", memberIds: ["a", "b"] }];
    day.events.find((e) => e.kind === "cricket")!.status = "reporting";
    writeDay(day);
    const r = await reportDartsScore(SEASON, DATE, "a", "cricket", 100, { isGm: false });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });
});

describe("confirmDartsEvent（GM確定・自動確定は廃止）", () => {
  const evOf = (k: string) => dayDoc()!.events.find((e) => e.kind === k)!;
  async function startedZeroOne() {
    ["a", "b", "c", "d"].forEach((u, i) => seedPaidEntry(u, i));
    await startDartsDay(SEASON, DATE, "gm");
    await setZeroOneVariant(SEASON, DATE, { start: 301, out: "double" });
  }
  const reportAllZeroOne = async () => {
    for (const u of ["a", "b", "c", "d"]) {
      await reportDartsScore(SEASON, DATE, u, "zeroOne", 100, { isGm: false });
    }
  };

  test("全員申告してもGM確定までは reporting のまま（自動確定しない）", async () => {
    await startedZeroOne();
    await reportAllZeroOne();
    expect(evOf("zeroOne").status).toBe("reporting");
    expect(evOf("countUp").status).toBe("pending"); // 次種目もまだ受付していない
  });

  test("全員申告済みならGMが確定でき、次の種目が受付になる", async () => {
    await startedZeroOne();
    await reportAllZeroOne();
    const r = await confirmDartsEvent(SEASON, DATE, "zeroOne");
    expect(r.ok).toBe(true);
    expect(evOf("zeroOne").status).toBe("confirmed");
    expect(evOf("countUp").status).toBe("reporting");
  });

  test("未申告が残る間は確定できない（409）", async () => {
    await startedZeroOne();
    await reportDartsScore(SEASON, DATE, "a", "zeroOne", 100, { isGm: false });
    const r = await confirmDartsEvent(SEASON, DATE, "zeroOne");
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(evOf("zeroOne").status).toBe("reporting");
  });

  test("pending（未受付）の種目は確定できない（409）", async () => {
    await startedZeroOne();
    const r = await confirmDartsEvent(SEASON, DATE, "countUp");
    expect(r).toMatchObject({ ok: false, status: 409 });
  });

  test("確定済みは冪等（already）", async () => {
    await startedZeroOne();
    await reportAllZeroOne();
    await confirmDartsEvent(SEASON, DATE, "zeroOne");
    const r2 = await confirmDartsEvent(SEASON, DATE, "zeroOne");
    expect(r2).toMatchObject({ ok: true, already: true });
  });

  test("終了後は確定できない（409）", async () => {
    await startedZeroOne();
    await reportAllZeroOne();
    writeDay({ ...(dayDoc() as DartsDayState), finishedAt: "2026-07-16T12:00:00.000Z" });
    const r = await confirmDartsEvent(SEASON, DATE, "zeroOne");
    expect(r).toMatchObject({ ok: false, status: 409 });
  });
});
