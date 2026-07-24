/**
 * 単体テスト: src/lib/pokerDay.ts の当日進行（ディーラー主導・複数試合・In-memory Firestore モック）。
 * ダーツ/ビリヤードの Tx テストと対称。要件 docs/games/poker/ポーカー-ルール草案.md §4〜§6。
 *
 * 検証: ディーラー選出→開始（受付締切・参加者確定）→終了→チップ申告→ディーラー確定→
 *       当日 scores 集計、代理入力/権限、次試合、中止（確定済みは不可）。
 */

jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/pokerSchedule", () => ({
  isScheduledPokerDate: jest.fn().mockResolvedValue(true),
  isPokerCancelledDate: jest.fn().mockResolvedValue(false),
}));

import { getDb } from "@/lib/firebaseAdmin";
import {
  assignPokerDealer,
  startPokerGame,
  endPokerGame,
  reportPokerChips,
  confirmPokerGame,
  cancelPokerDay,
} from "@/lib/pokerDay";
import type { PokerDayState } from "@/types/poker";

/* ───────── In-memory Firestore モック（transaction） ───────── */
type Data = Record<string, unknown>;
type Ref = { __c: string; id: string };
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
    delete: (c: string, id: string) => col(c).delete(id),
  };
  const docRef = (c: string, id?: string) => {
    const _id = id ?? `auto${++auto}`;
    return {
      __c: c,
      id: _id,
      get: async () => ({ exists: col(c).has(_id), id: _id, data: () => col(c).get(_id) }),
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
    get: async () => runQuery(c, filters),
  });
  const tx = {
    get: async (ref: { __filters?: [string, unknown][]; __c: string; get?: () => Promise<unknown> }) => {
      if (ref.__filters !== undefined) return runQuery(ref.__c, ref.__filters);
      return (ref as { get: () => Promise<unknown> }).get();
    },
    set: (ref: Ref, d: Data, o?: { merge?: boolean }) => mutate.set(ref.__c, ref.id, d, o?.merge),
    create: (ref: Ref, d: Data) => mutate.create(ref.__c, ref.id, d),
    delete: (ref: Ref) => mutate.delete(ref.__c, ref.id),
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
const DATE = "2026-07-04";
const MONTH = "2026-07";

beforeEach(() => {
  db = makeDb();
  (getDb as jest.Mock).mockReturnValue(db);
  const sched = jest.requireMock("@/lib/pokerSchedule");
  sched.isScheduledPokerDate.mockResolvedValue(true);
});

function seedPaid(uid: string, i: number, orderId: string | null = `ord-${uid}`) {
  const c = db.__store.get("pokerEntries") ?? new Map();
  db.__store.set("pokerEntries", c);
  c.set(`${SEASON}_${DATE}_${uid}`, {
    seasonId: SEASON, eventDate: DATE, lineUserId: uid, displayName: uid.toUpperCase(),
    status: "paid", paymentStatus: "paid", paymentTransactionId: orderId,
    paymentAmount: 1000, enteredAt: `2026-07-04T09:0${i}:00.000Z`,
  });
}
const day = () => db.__store.get("pokerDayState")?.get(`${SEASON}_${DATE}`) as PokerDayState | undefined;
const lastGame = () => day()!.games[day()!.games.length - 1];
const scoresFor = (uid: string) => db.__store.get("scores")?.get(`poker-${SEASON}-${DATE}-${uid}`) as Data | undefined;

/** a,b,c を paid にし、a をディーラーにして game1 を開始（b,c がプレイヤー）。 */
async function startGame1() {
  ["a", "b", "c"].forEach((u, i) => seedPaid(u, i));
  await assignPokerDealer(SEASON, DATE, "a");
  await startPokerGame(SEASON, DATE, "a");
}

describe("assignPokerDealer", () => {
  test("支払い済み参加者がディーラーになり dayState を作成（受付はまだ開いている）", async () => {
    ["a", "b", "c"].forEach((u, i) => seedPaid(u, i));
    const r = await assignPokerDealer(SEASON, DATE, "a");
    expect(r.ok).toBe(true);
    expect(day()?.entryClosedAt).toBeFalsy();
    expect(lastGame()).toMatchObject({ gameIndex: 1, dealerId: "a", status: "ready" });
  });

  test("未払い/非参加者はディーラーになれない（403）", async () => {
    ["a", "b", "c"].forEach((u, i) => seedPaid(u, i));
    const r = await assignPokerDealer(SEASON, DATE, "zzz");
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  test("参加者が3名未満なら作成できない（409）", async () => {
    ["a", "b"].forEach((u, i) => seedPaid(u, i));
    const r = await assignPokerDealer(SEASON, DATE, "a");
    expect(r).toMatchObject({ ok: false, status: 409 });
  });

  test("開始前(ready)はディーラーを差し替えできる", async () => {
    ["a", "b", "c"].forEach((u, i) => seedPaid(u, i));
    await assignPokerDealer(SEASON, DATE, "a");
    await assignPokerDealer(SEASON, DATE, "b");
    expect(day()?.games).toHaveLength(1);
    expect(lastGame().dealerId).toBe("b");
  });

  test("進行中(playing)は新しいディーラーを選べない（409）", async () => {
    await startGame1();
    const r = await assignPokerDealer(SEASON, DATE, "b");
    expect(r).toMatchObject({ ok: false, status: 409 });
  });
});

describe("startPokerGame", () => {
  test("最初の開始で participants 確定＋受付締切＋タイマー起点", async () => {
    ["a", "b", "c"].forEach((u, i) => seedPaid(u, i));
    await assignPokerDealer(SEASON, DATE, "a");
    const r = await startPokerGame(SEASON, DATE, "a");
    expect(r.ok).toBe(true);
    expect(day()?.entryClosedAt).toBeTruthy();
    expect(day()?.participants.map((p) => p.lineUserId).sort()).toEqual(["a", "b", "c"]);
    expect(lastGame()).toMatchObject({ status: "playing" });
    expect(lastGame().startedAt).toBeTruthy();
  });

  test("ディーラー以外は開始できない（403）", async () => {
    ["a", "b", "c"].forEach((u, i) => seedPaid(u, i));
    await assignPokerDealer(SEASON, DATE, "a");
    const r = await startPokerGame(SEASON, DATE, "b");
    expect(r).toMatchObject({ ok: false, status: 403 });
  });
});

describe("endPokerGame / reportPokerChips", () => {
  test("ディーラーが終了→プレイヤーが自己申告", async () => {
    await startGame1();
    expect((await endPokerGame(SEASON, DATE, "a")).ok).toBe(true);
    expect(lastGame().status).toBe("reporting");
    expect((await reportPokerChips(SEASON, DATE, "b", 15000, {})).ok).toBe(true);
    expect(lastGame().reports.b.chips).toBe(15000);
  });

  test("ディーラー(a)はプレイヤーではないので自己申告できない（403）", async () => {
    await startGame1();
    await endPokerGame(SEASON, DATE, "a");
    const r = await reportPokerChips(SEASON, DATE, "a", 100, {});
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  test("ディーラーは代理入力できる／非ディーラーの代理は拒否", async () => {
    await startGame1();
    await endPokerGame(SEASON, DATE, "a");
    expect((await reportPokerChips(SEASON, DATE, "a", 5000, { targetUserId: "b" })).ok).toBe(true);
    expect(lastGame().reports.b.chips).toBe(5000);
    const r = await reportPokerChips(SEASON, DATE, "b", 100, { targetUserId: "c" });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  test("チップは0〜(初期×人数)の範囲外を拒否", async () => {
    await startGame1();
    await endPokerGame(SEASON, DATE, "a");
    // プレイヤー2名 → 上限 20000
    const r = await reportPokerChips(SEASON, DATE, "b", 20001, {});
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  test("playing 中（終了前）は申告できない（409）", async () => {
    await startGame1();
    const r = await reportPokerChips(SEASON, DATE, "b", 100, {});
    expect(r).toMatchObject({ ok: false, status: 409 });
  });
});

describe("confirmPokerGame", () => {
  async function reported() {
    await startGame1();
    await endPokerGame(SEASON, DATE, "a");
    await reportPokerChips(SEASON, DATE, "b", 15000, {});
    await reportPokerChips(SEASON, DATE, "c", 5000, {});
  }
  test("全員申告後にディーラーが確定→当日 scores を書く", async () => {
    await reported();
    const r = await confirmPokerGame(SEASON, DATE, "a");
    expect(r.ok).toBe(true);
    expect(lastGame().status).toBe("confirmed");
    // b=15000(1位) / c=5000(2位)。a はディーラーで無得点＝score doc 無し。
    expect(scoresFor("b")).toMatchObject({ totalScore: 15000, gameCategory: "poker" });
    expect((scoresFor("b")!.details as Data).dayRank).toBe(1);
    expect(scoresFor("c")!.totalScore).toBe(5000);
    expect(scoresFor("a")).toBeUndefined();
    expect(db.__store.get("games")?.get(`poker-${SEASON}-${DATE}`)).toMatchObject({ scoreRegistered: true });
  });

  test("未申告が残る間は確定できない（409）", async () => {
    await startGame1();
    await endPokerGame(SEASON, DATE, "a");
    await reportPokerChips(SEASON, DATE, "b", 15000, {});
    const r = await confirmPokerGame(SEASON, DATE, "a");
    expect(r).toMatchObject({ ok: false, status: 409 });
  });

  test("ディーラー以外は確定できない（403）", async () => {
    await reported();
    const r = await confirmPokerGame(SEASON, DATE, "b");
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  test("確定済みは冪等（already）", async () => {
    await reported();
    await confirmPokerGame(SEASON, DATE, "a");
    const r2 = await confirmPokerGame(SEASON, DATE, "a");
    expect(r2).toMatchObject({ ok: true, already: true });
  });

  test("次の試合: 別のディーラーで2試合目を追加→チップ合算", async () => {
    await reported();
    await confirmPokerGame(SEASON, DATE, "a"); // 試合1: b=15000, c=5000
    // 試合2: b がディーラー。a,c がプレイヤー。
    expect((await assignPokerDealer(SEASON, DATE, "b")).ok).toBe(true);
    await startPokerGame(SEASON, DATE, "b");
    await endPokerGame(SEASON, DATE, "b");
    await reportPokerChips(SEASON, DATE, "a", 12000, {});
    await reportPokerChips(SEASON, DATE, "c", 8000, {});
    await confirmPokerGame(SEASON, DATE, "b");
    // b: 試合1のみ 15000 / c: 5000+8000=13000 / a: 試合2のみ 12000
    expect(scoresFor("b")!.totalScore).toBe(15000);
    expect(scoresFor("c")!.totalScore).toBe(13000);
    expect(scoresFor("a")!.totalScore).toBe(12000);
  });
});

describe("cancelPokerDay（管理者中止）", () => {
  test("受付前でも支払い済みは返金対象・dayState破棄・通知・中止doc", async () => {
    ["a", "b", "c"].forEach((u, i) => seedPaid(u, i));
    await assignPokerDealer(SEASON, DATE, "a");
    db.__store.set("pokerMonthlyLocks", new Map([[`${SEASON}_a_${MONTH}`, { eventDate: DATE }]]));
    const r = await cancelPokerDay(SEASON, DATE, "admin:x");
    expect(r).toMatchObject({ status: "forfeited", paidCount: 3, refundCount: 3 });
    expect(db.__store.get("pokerEntries")!.get(`${SEASON}_${DATE}_a`)!.status).toBe("cancelRequested");
    expect(db.__store.get("pokerMonthlyLocks")!.has(`${SEASON}_a_${MONTH}`)).toBe(false);
    expect(day()).toBeUndefined();
    expect(db.__store.get("pokerCancelledDates")!.has(DATE)).toBe(true);
    const notifs = Array.from((db.__store.get("adminNotifications") ?? new Map()).values());
    expect(notifs.some((n) => (n as Data).type === "poker_event_forfeit")).toBe(true);
  });

  test("確定済みの試合があると中止できない（finished）", async () => {
    await startGame1();
    await endPokerGame(SEASON, DATE, "a");
    await reportPokerChips(SEASON, DATE, "b", 15000, {});
    await reportPokerChips(SEASON, DATE, "c", 5000, {});
    await confirmPokerGame(SEASON, DATE, "a");
    const r = await cancelPokerDay(SEASON, DATE, "admin:x");
    expect(r).toEqual({ status: "finished" });
  });

  test("二重中止は冪等（already）", async () => {
    ["a", "b", "c"].forEach((u, i) => seedPaid(u, i));
    await cancelPokerDay(SEASON, DATE, "admin:x");
    const r2 = await cancelPokerDay(SEASON, DATE, "admin:x");
    expect(r2).toEqual({ status: "already" });
  });
});
