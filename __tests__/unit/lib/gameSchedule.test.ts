/**
 * 単体テスト（再発防止）: deleteGameScheduleDate（開催日の安全削除・参加者保護）。
 * トランザクション内で entry と schedule を読み、参加者がいれば削除しない（skipped）。
 * In-memory Firestore モック（transaction 逐次実行）で、参加表明が先に確定した場合に
 * 削除がスキップされること＝「entry確認直後に参加表明」競合の不変条件を検証する。
 */
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));

import { getDb } from "@/lib/firebaseAdmin";
import { deleteGameScheduleDate, buildGameScheduleId } from "@/lib/gameSchedule";

type Data = Record<string, unknown>;
function makeDb() {
  const store = new Map<string, Map<string, Data>>();
  const col = (n: string) => { if (!store.has(n)) store.set(n, new Map()); return store.get(n)!; };
  const runQuery = (c: string, f: [string, unknown][]) => {
    const docs = Array.from(col(c).entries())
      .filter(([, data]) => f.every(([k, v]) => data[k] === v))
      .map(([id, data]) => ({ id, ref: docRef(c, id), data: () => data }));
    return { docs, size: docs.length, empty: docs.length === 0 };
  };
  const query = (c: string, f: [string, unknown][]) => ({
    __c: c, __f: f,
    where: (k: string, _o: string, v: unknown) => query(c, [...f, [k, v]]),
    get: async () => runQuery(c, f),
  });
  const docRef = (c: string, id: string) => ({ __c: c, id, delete: async () => col(c).delete(id), get: async () => ({ exists: col(c).has(id), data: () => col(c).get(id) }) });
  const tx = {
    get: async (r: { __f?: [string, unknown][]; __c: string; get?: () => Promise<unknown> }) =>
      r.__f !== undefined ? runQuery(r.__c, r.__f) : (r as { get: () => Promise<unknown> }).get(),
    delete: (r: { __c: string; id: string }) => col(r.__c).delete(r.id),
  };
  return {
    collection: (n: string) => ({ doc: (id: string) => docRef(n, id), where: (k: string, _o: string, v: unknown) => query(n, [[k, v]]) }),
    runTransaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
    __store: store,
  };
}

let db: ReturnType<typeof makeDb>;
const SEASON = "s1";
const DATE = "2026-07-18";
beforeEach(() => { db = makeDb(); (getDb as jest.Mock).mockReturnValue(db); });

function seedSchedule(date: string) {
  db.__store.set("dartsSchedule", db.__store.get("dartsSchedule") ?? new Map());
  db.__store.get("dartsSchedule")!.set(buildGameScheduleId(SEASON, date), { scheduleId: buildGameScheduleId(SEASON, date), seasonId: SEASON, date });
}
function seedEntry(date: string, uid: string) {
  db.__store.set("dartsEntries", db.__store.get("dartsEntries") ?? new Map());
  db.__store.get("dartsEntries")!.set(`${SEASON}_${date}_${uid}`, { seasonId: SEASON, eventDate: date, lineUserId: uid });
}
const hasSchedule = (date: string) => db.__store.get("dartsSchedule")?.has(buildGameScheduleId(SEASON, date)) ?? false;

describe("deleteGameScheduleDate", () => {
  test("参加者なし → 削除（deleted）", async () => {
    seedSchedule(DATE);
    const r = await deleteGameScheduleDate(db as never, "darts", SEASON, DATE);
    expect(r).toBe("deleted");
    expect(hasSchedule(DATE)).toBe(false);
  });

  test("参加者あり → 保護（skipped）・schedule は残る", async () => {
    seedSchedule(DATE);
    seedEntry(DATE, "u1");
    const r = await deleteGameScheduleDate(db as never, "darts", SEASON, DATE);
    expect(r).toBe("skipped");
    expect(hasSchedule(DATE)).toBe(true);
  });

  test("「削除前に参加表明が確定」した競合: tx が entry を読んでスキップ", async () => {
    seedSchedule(DATE);
    // 参加表明が先にコミットされた状態で削除を実行 → tx 内の entry 読み取りで検知しスキップ。
    seedEntry(DATE, "late");
    const r = await deleteGameScheduleDate(db as never, "darts", SEASON, DATE);
    expect(r).toBe("skipped");
    expect(hasSchedule(DATE)).toBe(true);
  });

  test("別ゲームのコレクションに作用する（billiards）", async () => {
    db.__store.set("billiardsSchedule", new Map([[buildGameScheduleId(SEASON, DATE), { seasonId: SEASON, date: DATE }]]));
    const r = await deleteGameScheduleDate(db as never, "billiards", SEASON, DATE);
    expect(r).toBe("deleted");
    expect(db.__store.get("billiardsSchedule")!.has(buildGameScheduleId(SEASON, DATE))).toBe(false);
  });
});
