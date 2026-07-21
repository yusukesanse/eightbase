/**
 * 単体テスト（再発防止）: 開催日の安全削除（2フェーズ・決定的ロック）。
 * 空クエリの範囲ロックに依存せず、`scheduleLocks/{game}__{seasonId}__{date}` の blocked で直列化する。
 *
 * In-memory Firestore モック（transaction は逐次実行）。真の並行実行は Emulator 統合テストで
 * 検証する想定だが、ここでは「削除の結果状態」と「entry POST 側のロック読み取り」の不変条件を固める:
 *  - 参加者なし削除 → schedule 消滅＋ロックが blocked トゥームストーンで残る（後続 entry を弾ける）
 *  - 参加者あり削除 → schedule 保持＋ロック解除（skipped）
 *  - 削除“前”に参加表明が確定 → 再確認で検知して skipped
 *  - 再追加(clearScheduleLock) → ブロック解除
 */
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));

import { getDb } from "@/lib/firebaseAdmin";
import {
  deleteGameScheduleDate,
  clearScheduleLock,
  isScheduleDateBlockedInTx,
  buildGameScheduleId,
  scheduleLockId,
} from "@/lib/gameSchedule";

type Data = Record<string, unknown>;
interface QSnap { docs: { id: string; ref: unknown; data: () => Data }[]; size: number; empty: boolean }
interface QObj {
  __c: string;
  __f: [string, unknown][];
  where: (k: string, o: string, v: unknown) => QObj;
  limit: (n: number) => QObj;
  get: () => Promise<QSnap>;
}
function makeDb() {
  const store = new Map<string, Map<string, Data>>();
  const col = (n: string) => { if (!store.has(n)) store.set(n, new Map()); return store.get(n)!; };
  const applySet = (c: string, id: string, d: Data, merge?: boolean) =>
    col(c).set(id, merge ? { ...(col(c).get(id) ?? {}), ...d } : { ...d });
  const runQuery = (c: string, f: [string, unknown][], lim?: number): QSnap => {
    let docs = Array.from(col(c).entries())
      .filter(([, data]) => f.every(([k, v]) => data[k] === v))
      .map(([id, data]) => ({ id, ref: docRef(c, id), data: () => data }));
    if (lim) docs = docs.slice(0, lim);
    return { docs, size: docs.length, empty: docs.length === 0 };
  };
  function query(c: string, f: [string, unknown][], lim?: number): QObj {
    return {
      __c: c, __f: f,
      where: (k, _o, v) => query(c, [...f, [k, v]], lim),
      limit: (n) => query(c, f, n),
      get: async () => runQuery(c, f, lim),
    };
  }
  const docRef = (c: string, id: string) => ({
    __c: c, id,
    set: async (d: Data, o?: { merge?: boolean }) => applySet(c, id, d, o?.merge),
    delete: async () => col(c).delete(id),
    get: async () => ({ exists: col(c).has(id), data: () => col(c).get(id) }),
  });
  const batch = () => {
    const ops: (() => void)[] = [];
    return {
      set: (r: { __c: string; id: string }, d: Data, o?: { merge?: boolean }) => ops.push(() => applySet(r.__c, r.id, d, o?.merge)),
      delete: (r: { __c: string; id: string }) => ops.push(() => col(r.__c).delete(r.id)),
      commit: async () => ops.forEach((f) => f()),
    };
  };
  const tx = {
    get: async (r: { __f?: [string, unknown][]; __c: string; get?: () => Promise<unknown> }) =>
      r.__f !== undefined ? runQuery(r.__c, r.__f) : (r as { get: () => Promise<unknown> }).get(),
  };
  return {
    collection: (n: string) => ({ doc: (id: string) => docRef(n, id), where: (k: string, o: string, v: unknown) => query(n, [[k, v]]) }),
    batch,
    runTransaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
    __store: store,
  };
}

let db: ReturnType<typeof makeDb>;
const SEASON = "s1";
const DATE = "2026-07-18";
beforeEach(() => { db = makeDb(); (getDb as jest.Mock).mockReturnValue(db); });

const seedSchedule = (date: string) => {
  db.__store.set("dartsSchedule", db.__store.get("dartsSchedule") ?? new Map());
  db.__store.get("dartsSchedule")!.set(buildGameScheduleId(SEASON, date), { seasonId: SEASON, date });
};
const seedEntry = (date: string, uid: string) => {
  db.__store.set("dartsEntries", db.__store.get("dartsEntries") ?? new Map());
  db.__store.get("dartsEntries")!.set(`${SEASON}_${date}_${uid}`, { seasonId: SEASON, eventDate: date, lineUserId: uid });
};
const hasSchedule = (date: string) => db.__store.get("dartsSchedule")?.has(buildGameScheduleId(SEASON, date)) ?? false;
const lockData = (date: string) => db.__store.get("scheduleLocks")?.get(scheduleLockId("darts", SEASON, date));
const blockedInTx = (date: string) => db.runTransaction((tx) => isScheduleDateBlockedInTx(tx as never, db as never, "darts", SEASON, date));

describe("deleteGameScheduleDate（2フェーズ・ロック）", () => {
  test("参加者なし → 削除＋blockedトゥームストーンが残り、後続entryを弾ける", async () => {
    seedSchedule(DATE);
    expect(await blockedInTx(DATE)).toBe(false);
    const r = await deleteGameScheduleDate(db as never, "darts", SEASON, DATE);
    expect(r).toBe("deleted");
    expect(hasSchedule(DATE)).toBe(false);
    expect((lockData(DATE) as { blocked?: boolean })?.blocked).toBe(true);
    expect(await blockedInTx(DATE)).toBe(true); // 削除完了後も entry POST は弾ける
  });

  test("参加者あり → 保護（skipped）・schedule保持・ロック解除", async () => {
    seedSchedule(DATE);
    seedEntry(DATE, "u1");
    const r = await deleteGameScheduleDate(db as never, "darts", SEASON, DATE);
    expect(r).toBe("skipped");
    expect(hasSchedule(DATE)).toBe(true);
    expect(lockData(DATE)).toBeUndefined(); // 受付を戻す（blocked解除）
    expect(await blockedInTx(DATE)).toBe(false);
  });

  test("削除“前”に参加表明が確定 → 再確認で検知して skipped", async () => {
    seedSchedule(DATE);
    seedEntry(DATE, "late"); // phase1 の前に確定した想定
    const r = await deleteGameScheduleDate(db as never, "darts", SEASON, DATE);
    expect(r).toBe("skipped");
    expect(hasSchedule(DATE)).toBe(true);
    expect(await blockedInTx(DATE)).toBe(false);
  });

  test("再追加（clearScheduleLock）でブロック解除", async () => {
    seedSchedule(DATE);
    await deleteGameScheduleDate(db as never, "darts", SEASON, DATE); // blocked トゥームストーン
    expect(await blockedInTx(DATE)).toBe(true);
    await clearScheduleLock(db as never, "darts", SEASON, DATE);
    expect(await blockedInTx(DATE)).toBe(false);
  });
});
