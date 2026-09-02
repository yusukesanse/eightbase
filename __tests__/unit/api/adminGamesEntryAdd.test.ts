jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/adminAuth", () => ({ checkAdminAuth: jest.fn() }));
jest.mock("@/lib/auditLog", () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/mahjong", () => ({ getActiveSeason: jest.fn() }));

import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { writeAuditLog } from "@/lib/auditLog";
import { getActiveSeason } from "@/lib/mahjong";
import { POST } from "@/app/api/admin/games/entries/route";
import { DARTS_ENTRY_FEE } from "@/types/darts";
import type { NextRequest } from "next/server";

type Data = Record<string, unknown>;

function makeDb() {
  const store = new Map<string, Map<string, Data>>();
  const col = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name)!;
  };
  const docRef = (collectionName: string, id: string) => ({
    __c: collectionName,
    id,
    get: async () => ({
      exists: col(collectionName).has(id),
      id,
      data: () => col(collectionName).get(id),
    }),
    set: async (data: Data) => { col(collectionName).set(id, { ...data }); },
    update: async (data: Data) => {
      const current = col(collectionName).get(id) ?? {};
      col(collectionName).set(id, { ...current, ...data });
    },
    delete: async () => { col(collectionName).delete(id); },
  });
  const query = (collectionName: string, conditions: [string, unknown][], limit?: number) => ({
    where: (field: string, _op: string, value: unknown) =>
      query(collectionName, [...conditions, [field, value]], limit),
    limit: (size: number) => query(collectionName, conditions, size),
    get: async () => {
      const rows = [...col(collectionName).entries()]
        .filter(([, value]) => conditions.every(([field, expected]) => value[field] === expected))
        .map(([id, value]) => ({ id, data: () => value }));
      const docs = limit == null ? rows : rows.slice(0, limit);
      return { docs, empty: docs.length === 0, size: docs.length };
    },
  });

  return {
    collection: (collectionName: string) => ({
      doc: (id: string) => docRef(collectionName, id),
      where: (field: string, _op: string, value: unknown) =>
        query(collectionName, [[field, value]]),
    }),
    runTransaction: async (fn: (tx: {
      get: (ref: ReturnType<typeof docRef>) => ReturnType<ReturnType<typeof docRef>["get"]>;
      set: (ref: ReturnType<typeof docRef>, data: Data, options?: { merge?: boolean }) => void;
      update: (ref: ReturnType<typeof docRef>, data: Data) => void;
    }) => Promise<void>) => {
      const tx = {
        get: (ref: ReturnType<typeof docRef>) => ref.get(),
        set: (ref: ReturnType<typeof docRef>, data: Data, options?: { merge?: boolean }) => {
          const current = options?.merge ? (col(ref.__c).get(ref.id) ?? {}) : {};
          col(ref.__c).set(ref.id, { ...current, ...data });
        },
        update: (ref: ReturnType<typeof docRef>, data: Data) => {
          const current = col(ref.__c).get(ref.id) ?? {};
          col(ref.__c).set(ref.id, { ...current, ...data });
        },
      };
      await fn(tx);
    },
    __get: (collectionName: string, id: string) => store.get(collectionName)?.get(id),
    __set: (collectionName: string, id: string, data: Data) => col(collectionName).set(id, data),
    __size: (collectionName: string) => store.get(collectionName)?.size ?? 0,
  };
}

let db: ReturnType<typeof makeDb>;

const SEASON = "s1";
const DATE = "2026-09-05";
const USER_ID = "u1";

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function add(overrides: Data = {}) {
  return POST(req({
    gameCategory: "darts",
    seasonId: SEASON,
    eventDate: DATE,
    lineUserId: USER_ID,
    ...overrides,
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  db = makeDb();
  (getDb as jest.Mock).mockReturnValue(db);
  (checkAdminAuth as jest.Mock).mockResolvedValue("admin@example.com");
  (getActiveSeason as jest.Mock).mockResolvedValue({ seasonId: SEASON });
  (writeAuditLog as jest.Mock).mockResolvedValue(undefined);
  db.__set("authorizedUsers", "auth-u1", {
    lineUserId: USER_ID,
    displayName: "会員A",
    role: "member",
    active: true,
  });
  db.__set("users", USER_ID, {
    displayName: "会員A",
    pictureUrl: "https://example.com/u1.png",
  });
});

describe("POST /api/admin/games/entries", () => {
  test("管理者でなければ 401", async () => {
    (checkAdminAuth as jest.Mock).mockResolvedValue(null);
    expect((await add()).status).toBe(401);
  });

  test("不正な gameCategory は 400", async () => {
    const res = await add({ gameCategory: "soccer" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "gameCategory が不正です" });
  });

  test("実在しない eventDate は 400", async () => {
    const res = await add({ eventDate: "2026-13-40" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "eventDate が不正です" });
  });

  test("lineUserId が欠落していれば 400", async () => {
    const res = await POST(req({ gameCategory: "darts", seasonId: SEASON, eventDate: DATE }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "lineUserId が不正です" });
  });

  test("アクティブシーズンと不一致なら 409 で書き込まない", async () => {
    const res = await add({ seasonId: "old-season" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "SEASON_MISMATCH" });
    expect(db.__size("dartsEntries")).toBe(0);
  });

  test("darts の開始前は paid entry と月ロックを作る", async () => {
    const res = await add();
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ rosterUpdated: false });
    expect(db.__get("dartsEntries", `${SEASON}_${DATE}_${USER_ID}`)).toMatchObject({
      status: "paid",
      paymentStatus: "paid",
      paymentAmount: DARTS_ENTRY_FEE,
    });
    expect(db.__get("dartsMonthlyLocks", `${SEASON}_${USER_ID}_2026-09`)).toMatchObject({
      seasonId: SEASON,
      eventDate: DATE,
      lineUserId: USER_ID,
    });
    expect(getActiveSeason).toHaveBeenCalledWith("darts");
  });

  test("darts の開始後は名簿にいない新規参加者を拒否する", async () => {
    db.__set("dartsDayState", `${SEASON}_${DATE}`, {
      entryClosedAt: "2026-09-05T09:00:00.000Z",
      participants: [],
    });
    const res = await add();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "DAY_STARTED" });
    expect(db.__size("dartsEntries")).toBe(0);
    expect(db.__size("dartsMonthlyLocks")).toBe(0);
  });

  test("darts の開始後でも名簿上の未払い参加者は paid に更新できる", async () => {
    db.__set("dartsDayState", `${SEASON}_${DATE}`, {
      entryClosedAt: "2026-09-05T09:00:00.000Z",
      participants: [
        { lineUserId: USER_ID, displayName: "会員A", paid: false },
        { lineUserId: "u2", displayName: "会員B", paid: false },
      ],
    });

    const res = await add();
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ rosterUpdated: true });
    const day = db.__get("dartsDayState", `${SEASON}_${DATE}`) as Data;
    expect(day.participants).toEqual([
      { lineUserId: USER_ID, displayName: "会員A", paid: true },
      { lineUserId: "u2", displayName: "会員B", paid: false },
    ]);
    expect(db.__get("dartsEntries", `${SEASON}_${DATE}_${USER_ID}`)).toMatchObject({
      paymentStatus: "paid",
    });
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "entry.adminAdded",
      gameCategory: "darts",
      actor: "admin:admin@example.com",
      meta: expect.objectContaining({ rosterUpdated: true }),
    }));
  });

  test("darts の終了後は追加を拒否する", async () => {
    db.__set("dartsDayState", `${SEASON}_${DATE}`, {
      entryClosedAt: "2026-09-05T09:00:00.000Z",
      finishedAt: "2026-09-05T12:00:00.000Z",
      participants: [{ lineUserId: USER_ID, paid: false }],
    });
    const res = await add();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "DAY_FINISHED" });
    expect(db.__size("dartsEntries")).toBe(0);
    expect(db.__size("dartsMonthlyLocks")).toBe(0);
  });

  test("poker は poker 専用コレクションへ書き込む", async () => {
    const res = await add({ gameCategory: "poker" });
    expect(res.status).toBe(201);
    expect(db.__get("pokerEntries", `${SEASON}_${DATE}_${USER_ID}`)).toBeDefined();
    expect(db.__get("pokerMonthlyLocks", `${SEASON}_${USER_ID}_2026-09`)).toBeDefined();
    expect(db.__size("dartsEntries")).toBe(0);
    expect(db.__size("dartsMonthlyLocks")).toBe(0);
  });

  test("mahjong は開始済みでも名簿ルールを適用せず追加できる", async () => {
    db.__set("mahjongDayState", `${SEASON}_${DATE}`, {
      entryClosedAt: "2026-09-05T09:00:00.000Z",
      participants: [],
    });
    const res = await add({ gameCategory: "mahjong" });
    expect(res.status).toBe(201);
    expect(db.__get("mahjongEntries", `${SEASON}_${DATE}_${USER_ID}`)).toBeDefined();
  });

  test("markPaid:false は reserved で paymentStatus を付けない", async () => {
    const res = await add({ markPaid: false });
    expect(res.status).toBe(201);
    const entry = db.__get("dartsEntries", `${SEASON}_${DATE}_${USER_ID}`) as Data;
    expect(entry.status).toBe("reserved");
    expect(entry.paymentStatus).toBeUndefined();
  });
});
