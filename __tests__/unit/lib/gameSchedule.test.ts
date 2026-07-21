/**
 * 単体テスト（再発防止）: 開催日の安全削除（operationId 付き2フェーズ・決定的ロック）。
 * 「削除↔参加表明↔再追加」の競合で「schedule 無し・lock 無し」を作らないことを検証する。
 *
 * In-memory Firestore モック（transaction 逐次実行）。真の並行は Emulator 統合テストで検証する想定。
 * ここでは「entries 再確認の最中に再追加が割り込む」順序をフックで注入し、最終状態の不変条件を固める。
 */
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));

import { getDb } from "@/lib/firebaseAdmin";
import {
  deleteGameScheduleDate,
  addGameScheduleDate,
  isScheduleDateBlockedInTx,
  buildGameScheduleId,
  scheduleLockId,
} from "@/lib/gameSchedule";

type Data = Record<string, unknown>;
interface QSnap { docs: { id: string; ref: unknown; data: () => Data }[]; size: number; empty: boolean }
interface QObj { __c: string; __f: [string, unknown][]; where: (k: string, o: string, v: unknown) => QObj; limit: (n: number) => QObj; get: () => Promise<QSnap> }

function makeDb() {
  const store = new Map<string, Map<string, Data>>();
  let txCount = 0;
  let failTxAt = -1; // n番目の runTransaction を失敗させる
  let entryGetHook: (() => void) | null = null; // Entries の get 時に一度だけ実行
  const col = (n: string) => { if (!store.has(n)) store.set(n, new Map()); return store.get(n)!; };
  const applySet = (c: string, id: string, d: Data, merge?: boolean) =>
    col(c).set(id, merge ? { ...(col(c).get(id) ?? {}), ...d } : { ...d });
  const runQuery = (c: string, f: [string, unknown][], lim?: number): QSnap => {
    if (c.endsWith("Entries") && entryGetHook) { const h = entryGetHook; entryGetHook = null; h(); }
    let docs = Array.from(col(c).entries())
      .filter(([, data]) => f.every(([k, v]) => data[k] === v))
      .map(([id, data]) => ({ id, ref: docRef(c, id), data: () => data }));
    if (lim) docs = docs.slice(0, lim);
    return { docs, size: docs.length, empty: docs.length === 0 };
  };
  function query(c: string, f: [string, unknown][], lim?: number): QObj {
    return { __c: c, __f: f, where: (k, _o, v) => query(c, [...f, [k, v]], lim), limit: (n) => query(c, f, n), get: async () => runQuery(c, f, lim) };
  }
  const docRef = (c: string, id: string) => ({
    __c: c, id,
    set: async (d: Data, o?: { merge?: boolean }) => applySet(c, id, d, o?.merge),
    delete: async () => col(c).delete(id),
    get: async () => ({ exists: col(c).has(id), data: () => col(c).get(id) }),
  });
  const tx = {
    get: async (r: { __f?: [string, unknown][]; __c: string; get?: () => Promise<unknown> }) =>
      r.__f !== undefined ? runQuery(r.__c, r.__f) : (r as { get: () => Promise<unknown> }).get(),
    set: (r: { __c: string; id: string }, d: Data, o?: { merge?: boolean }) => applySet(r.__c, r.id, d, o?.merge),
    delete: (r: { __c: string; id: string }) => col(r.__c).delete(r.id),
  };
  return {
    collection: (n: string) => ({ doc: (id: string) => docRef(n, id), where: (k: string, o: string, v: unknown) => query(n, [[k, v]]) }),
    runTransaction: async <T>(fn: (t: typeof tx) => Promise<T>) => {
      txCount += 1;
      if (txCount === failTxAt) throw new Error("TX_FAILED");
      return fn(tx);
    },
    __store: store,
    __failTxAt: (n: number) => { failTxAt = n; },
    __onEntryGet: (fn: () => void) => { entryGetHook = fn; },
  };
}

let db: ReturnType<typeof makeDb>;
const SEASON = "s1";
const DATE = "2026-07-18";
beforeEach(() => { db = makeDb(); (getDb as jest.Mock).mockReturnValue(db); });

const seedSchedule = (date = DATE) => {
  db.__store.set("dartsSchedule", db.__store.get("dartsSchedule") ?? new Map());
  db.__store.get("dartsSchedule")!.set(buildGameScheduleId(SEASON, date), { seasonId: SEASON, date });
};
const seedEntry = (uid: string, date = DATE) => {
  db.__store.set("dartsEntries", db.__store.get("dartsEntries") ?? new Map());
  db.__store.get("dartsEntries")!.set(`${SEASON}_${date}_${uid}`, { seasonId: SEASON, eventDate: date, lineUserId: uid });
};
const hasSchedule = (date = DATE) => db.__store.get("dartsSchedule")?.has(buildGameScheduleId(SEASON, date)) ?? false;
const lock = (date = DATE) => db.__store.get("scheduleLocks")?.get(scheduleLockId("darts", SEASON, date)) as { blocked?: boolean; operationId?: string } | undefined;
const deleteLockDirect = (date = DATE) => db.__store.get("scheduleLocks")?.delete(scheduleLockId("darts", SEASON, date));
const blocked = (date = DATE) => db.runTransaction((tx) => isScheduleDateBlockedInTx(tx as never, db as never, "darts", SEASON, date));

describe("削除・再追加・entry の最終状態", () => {
  test("参加者なし → deleted。schedule 消滅・blockedトゥームストーンで後続entryをブロック", async () => {
    seedSchedule();
    expect(await blocked()).toBe(false);
    expect(await deleteGameScheduleDate(db as never, "darts", SEASON, DATE)).toBe("deleted");
    expect(hasSchedule()).toBe(false);
    expect(lock()?.blocked).toBe(true);
    expect(lock()?.operationId).toBeTruthy();
    expect(await blocked()).toBe(true); // 「schedule無し ⟹ blockedロックあり」＝entry作成不可
  });

  test("参加者あり → skipped。schedule保持・ロック解除", async () => {
    seedSchedule();
    seedEntry("u1");
    expect(await deleteGameScheduleDate(db as never, "darts", SEASON, DATE)).toBe("skipped");
    expect(hasSchedule()).toBe(true);
    expect(lock()).toBeUndefined();
    expect(await blocked()).toBe(false);
  });

  test("phase1直後に同日を再追加（entries再確認中に注入）→ reAdded。schedule保持・schedule削除されない", async () => {
    seedSchedule();
    // entries 再確認（phase1 と phase2 の間）に「再追加」を注入: ロック削除＋schedule作成。
    db.__onEntryGet(() => { deleteLockDirect(); seedSchedule(); });
    const r = await deleteGameScheduleDate(db as never, "darts", SEASON, DATE);
    expect(r).toBe("reAdded"); // 再追加が割り込んだので削除しない
    expect(hasSchedule()).toBe(true); // 再追加された schedule が残る
    expect(await blocked()).toBe(false); // schedule あり・lock 無し（正しい：開催日は存在）
  });

  test("「schedule無し＋lock無し」は発生しない（削除後は必ず blocked ロックが残る）", async () => {
    seedSchedule();
    await deleteGameScheduleDate(db as never, "darts", SEASON, DATE);
    // 削除後: schedule 無し だが lock は blocked で残る。
    expect(hasSchedule()).toBe(false);
    expect(lock()?.blocked).toBe(true);
  });

  test("addGameScheduleDate は原子的（schedule作成＋ロック解除）＝再追加で受付再開", async () => {
    seedSchedule();
    await deleteGameScheduleDate(db as never, "darts", SEASON, DATE); // blocked トゥームストーン
    expect(await blocked()).toBe(true);
    await addGameScheduleDate(db as never, "darts", SEASON, DATE);
    expect(hasSchedule()).toBe(true);
    expect(lock()).toBeUndefined();
    expect(await blocked()).toBe(false);
  });

  test("ロック解除失敗を成功扱いにしない（skip時の解除tx失敗は throw）", async () => {
    seedSchedule();
    seedEntry("u1");
    db.__failTxAt(2); // phase1=1回目, skip解除=2回目 を失敗させる
    await expect(deleteGameScheduleDate(db as never, "darts", SEASON, DATE)).rejects.toThrow();
  });
});
