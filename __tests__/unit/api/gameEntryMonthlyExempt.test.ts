/**
 * 単体テスト: POST /api/{mahjong,darts}/entries の「月1回まで」と、その管理者免除。
 *
 * 固定する仕様:
 *  - 免除なし: 同月の別日に参加表明すると 409 MONTHLY_LIMIT（従来どおり）
 *  - 免除あり（authorizedUsers.monthlyEntryExempt=true）: 同月の別日でも 201
 *  - 免除しても**定員は免除しない**（満員なら 409 FULL）
 *  - 免除ユーザーでも月ロック doc は今までどおり書く（免除を外したあとに壊れないため）
 *
 * ※ 判定はサーバーが正。クライアントのカレンダー表示は monthlyEntryExempt.test.ts 側で固定。
 */
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/auth", () => ({
  requireGameUser: jest.fn(),
  requireGameUserWithRole: jest.fn(),
}));
jest.mock("@/lib/mahjong", () => ({ getActiveSeason: jest.fn() }));
jest.mock("@/lib/mahjongDay", () => ({ getDayState: jest.fn(), isEntryClosed: () => false }));
jest.mock("@/lib/mahjongSchedule", () => ({ listMahjongScheduleDates: jest.fn() }));
jest.mock("@/lib/dartsSchedule", () => ({
  isScheduledDartsDate: async () => true,
  isDartsCancelledDate: async () => false,
}));
jest.mock("@/lib/dartsDay", () => ({ getDartsDayState: async () => null, isDartsEntryClosed: () => false }));
jest.mock("@/lib/entryDeadline", () => ({
  isEntryClosedByTime: async () => false,
  ENTRY_DEADLINE_PASSED_MESSAGE: "受付を締め切りました",
}));
jest.mock("@/lib/gameSchedule", () => ({ isScheduleDateBlockedInTx: async () => false }));

import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUserWithRole } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { listMahjongScheduleDates } from "@/lib/mahjongSchedule";
import { POST as mahjongPost } from "@/app/api/mahjong/entries/route";
import { POST as dartsPost } from "@/app/api/darts/entries/route";
import type { NextRequest } from "next/server";

type Data = Record<string, unknown>;

const SEASON = "S1";
const USER = "U_user";
const DATE_A = "2026-07-11"; // 土曜
const DATE_B = "2026-07-18"; // 同月の別の土曜
const DATE_C = "2026-07-25"; // 同月の3日目

/** トランザクション（tx.get で docRef と where クエリの両方を扱う）に対応する簡易 Firestore。 */
function makeDb() {
  const store = new Map<string, Map<string, Data>>();
  const col = (n: string) => {
    if (!store.has(n)) store.set(n, new Map());
    return store.get(n)!;
  };
  const docRef = (c: string, id: string) => ({
    __kind: "doc" as const,
    __c: c,
    id,
    get: async () => ({ exists: col(c).has(id), id, data: () => col(c).get(id) }),
    delete: async () => { col(c).delete(id); },
  });
  const query = (c: string, conds: [string, unknown][]) => ({
    __kind: "query" as const,
    __c: c,
    __conds: conds,
    where: (f: string, _op: string, v: unknown) => query(c, [...conds, [f, v]]),
    get: async () => {
      const docs = [...col(c).entries()]
        .filter(([, v]) => conds.every(([f, val]) => v[f] === val))
        .map(([id, v]) => ({ id, data: () => v }));
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  });
  type Ref = ReturnType<typeof docRef> | ReturnType<typeof query>;
  const db = {
    collection: (c: string) => ({
      doc: (id: string) => docRef(c, id),
      where: (f: string, _op: string, v: unknown) => query(c, [[f, v]]),
    }),
    runTransaction: async (fn: (tx: unknown) => Promise<void>) => {
      const writes: [string, string, Data, boolean][] = [];
      const tx = {
        get: async (ref: Ref) => (ref.__kind === "doc" ? ref.get() : ref.get()),
        set: (ref: ReturnType<typeof docRef>, d: Data, opt?: { merge?: boolean }) => {
          writes.push([ref.__c, ref.id, d, !!opt?.merge]);
        },
      };
      await fn(tx);
      // 例外が出たら writes は捨てる（呼び出し側で catch される）＝ロールバック相当。
      writes.forEach(([c, id, d, merge]) => {
        col(c).set(id, merge ? { ...(col(c).get(id) ?? {}), ...d } : { ...d });
      });
    },
    __set: (c: string, id: string, d: Data) => col(c).set(id, d),
    __get: (c: string, id: string) => col(c).get(id),
    __size: (c: string) => col(c).size,
  };
  return db;
}

let db: ReturnType<typeof makeDb>;

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function setUser(monthlyEntryExempt: boolean) {
  (requireGameUserWithRole as jest.Mock).mockResolvedValue({
    lineUserId: USER,
    role: "member",
    monthlyEntryExempt,
  });
}

beforeEach(() => {
  db = makeDb();
  (getDb as jest.Mock).mockReturnValue(db);
  (getActiveSeason as jest.Mock).mockResolvedValue({ seasonId: SEASON });
  (listMahjongScheduleDates as jest.Mock).mockResolvedValue(new Set([DATE_A, DATE_B, DATE_C]));
  db.__set("users", USER, { displayName: "テスト太郎", pictureUrl: "" });
});

describe("麻雀: 月1回の制限と免除", () => {
  test("免除なし: 同月の別日は 409（従来どおり）", async () => {
    setUser(false);
    expect((await mahjongPost(req({ eventDate: DATE_A }))).status).toBe(201);

    const res = await mahjongPost(req({ eventDate: DATE_B }));
    expect(res.status).toBe(409);
    expect((await res.json()).monthlyLimit).toBe(true);
    expect(db.__size("mahjongEntries")).toBe(1);
  });

  test("免除あり: 同月の別日も参加できる", async () => {
    setUser(true);
    expect((await mahjongPost(req({ eventDate: DATE_A }))).status).toBe(201);
    expect((await mahjongPost(req({ eventDate: DATE_B }))).status).toBe(201);
    expect(db.__size("mahjongEntries")).toBe(2);
  });

  test("免除ユーザーでも月ロックは書かれる（免除を外したあとに壊れない）", async () => {
    setUser(true);
    await mahjongPost(req({ eventDate: DATE_A }));
    await mahjongPost(req({ eventDate: DATE_B }));
    const lock = db.__get("mahjongMonthlyLocks", `${SEASON}_${USER}_2026-07`);
    expect(lock?.eventDate).toBe(DATE_B);

    // 免除を外すと、そのロックが指す参加が実在するので再び月1回に戻る。
    setUser(false);
    const res = await mahjongPost(req({ eventDate: DATE_C }));
    expect(res.status).toBe(409);
    expect((await res.json()).monthlyLimit).toBe(true);
  });

  test("免除しても定員は免除しない（満員なら 409）", async () => {
    setUser(true);
    for (let i = 0; i < 8; i++) {
      db.__set("mahjongEntries", `other-${i}`, { seasonId: SEASON, eventDate: DATE_B, lineUserId: `U_o${i}` });
    }
    await mahjongPost(req({ eventDate: DATE_A }));
    const res = await mahjongPost(req({ eventDate: DATE_B }));
    expect(res.status).toBe(409);
    expect((await res.json()).full).toBe(true);
  });
});

describe("ダーツ: 同じ免除フラグが効く（4種目共通）", () => {
  test("免除なしは 409 / 免除ありは 201", async () => {
    setUser(false);
    expect((await dartsPost(req({ eventDate: DATE_A }))).status).toBe(201);
    expect((await dartsPost(req({ eventDate: DATE_B }))).status).toBe(409);

    db = makeDb();
    (getDb as jest.Mock).mockReturnValue(db);
    db.__set("users", USER, { displayName: "テスト太郎", pictureUrl: "" });
    setUser(true);
    expect((await dartsPost(req({ eventDate: DATE_A }))).status).toBe(201);
    expect((await dartsPost(req({ eventDate: DATE_B }))).status).toBe(201);
  });
});
