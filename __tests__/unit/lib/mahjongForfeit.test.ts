/**
 * 単体テスト: src/lib/mahjongForfeit.ts forfeitDayIfInsufficient
 * 人数不足の自動中止（流会）の判定・状態遷移・通知・冪等性を getDb モックで検証する。
 */
type Entry = {
  id: string;
  eventDate: string;
  lineUserId: string;
  displayName: string;
  status?: string;
  paymentStatus?: string;
  paymentTransactionId?: string;
  paymentAmount?: number;
};

type BatchOp = { op: "set" | "delete"; coll: string; id: string; data?: Record<string, unknown> };

const mockState: {
  cancelledExists: boolean;
  createThrows: boolean;
  tables: { eventDate: string }[];
  entries: Entry[];
  created: { id: string } | null;
  batchOps: BatchOp[];
} = { cancelledExists: false, createThrows: false, tables: [], entries: [], created: null, batchOps: [] };

const mockCommit = jest.fn(async () => {});
const mockNotify = jest.fn(async () => {});
const mockSend = jest.fn(async () => {});

const mockDb = {
  collection: (name: string) => ({
    doc: (id: string) => ({
      id,
      __coll: name,
      get: async () =>
        name === "mahjongCancelledDates" ? { exists: mockState.cancelledExists } : { exists: false },
      create: async () => {
        if (mockState.createThrows) throw new Error("already-exists");
        mockState.created = { id };
      },
    }),
    where: () => ({
      get: async () => {
        if (name === "mahjongTables") return { docs: mockState.tables.map((t) => ({ data: () => t })) };
        if (name === "mahjongEntries") return { docs: mockState.entries.map((e) => ({ id: e.id, data: () => e })) };
        return { docs: [] };
      },
    }),
  }),
  batch: () => ({
    set: (ref: { __coll: string; id: string }, data: Record<string, unknown>) =>
      mockState.batchOps.push({ op: "set", coll: ref.__coll, id: ref.id, data }),
    delete: (ref: { __coll: string; id: string }) =>
      mockState.batchOps.push({ op: "delete", coll: ref.__coll, id: ref.id }),
    commit: mockCommit,
  }),
};

jest.mock("@/lib/firebaseAdmin", () => ({ getDb: () => mockDb }));
jest.mock("@/lib/adminNotify", () => ({ notifyAdmin: mockNotify }));
jest.mock("@/lib/line", () => ({ sendMahjongForfeitNotice: mockSend }));

import { forfeitDayIfInsufficient } from "@/lib/mahjongForfeit";

const DATE = "2026-08-08";
const paidEntry = (id: string, withTxn = true): Entry => ({
  id,
  eventDate: DATE,
  lineUserId: `u-${id}`,
  displayName: id,
  status: "paid",
  paymentStatus: "paid",
  ...(withTxn ? { paymentTransactionId: `order-${id}`, paymentAmount: 3000 } : {}),
});
const reservedEntry = (id: string): Entry => ({
  id,
  eventDate: DATE,
  lineUserId: `u-${id}`,
  displayName: id,
  status: "reserved",
});

beforeEach(() => {
  mockState.cancelledExists = false;
  mockState.createThrows = false;
  mockState.tables = [];
  mockState.entries = [];
  mockState.created = null;
  mockState.batchOps = [];
  mockCommit.mockClear();
  mockNotify.mockClear();
  mockSend.mockClear();
});

describe("forfeitDayIfInsufficient", () => {
  test("支払い済み3名 → 中止確定・返金遷移・通知・LINE送信", async () => {
    mockState.entries = [paidEntry("a"), paidEntry("b"), paidEntry("c")];
    const r = await forfeitDayIfInsufficient("s1", DATE);
    expect(r).toEqual({ status: "forfeited", paidCount: 3, refundCount: 3 });
    expect(mockState.created).toEqual({ id: DATE }); // cancelledDates 作成
    // paid 3件が cancelRequested + forfeit へ
    const entrySets = mockState.batchOps.filter((o) => o.op === "set" && o.coll === "mahjongEntries");
    expect(entrySets).toHaveLength(3);
    expect(entrySets[0].data).toMatchObject({ status: "cancelRequested", cancelReason: "forfeit" });
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(3); // 着席予定者へ中止通知
  });

  test("支払い済み4名 → 成立（中止しない）", async () => {
    mockState.entries = [paidEntry("a"), paidEntry("b"), paidEntry("c"), paidEntry("d")];
    const r = await forfeitDayIfInsufficient("s1", DATE);
    expect(r).toEqual({ status: "ok", paidCount: 4 });
    expect(mockState.created).toBeNull();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  test("既に中止確定済み → already（冪等）", async () => {
    mockState.cancelledExists = true;
    mockState.entries = [paidEntry("a")];
    const r = await forfeitDayIfInsufficient("s1", DATE);
    expect(r).toEqual({ status: "already" });
    expect(mockNotify).not.toHaveBeenCalled();
  });

  test("卓が既にある（開催済み）→ started", async () => {
    mockState.tables = [{ eventDate: DATE }];
    mockState.entries = [paidEntry("a"), paidEntry("b")];
    const r = await forfeitDayIfInsufficient("s1", DATE);
    expect(r).toEqual({ status: "started" });
  });

  test("支払い済み0名 → no-participants（記録しない）", async () => {
    mockState.entries = [reservedEntry("a")];
    const r = await forfeitDayIfInsufficient("s1", DATE);
    expect(r).toEqual({ status: "no-participants" });
    expect(mockState.created).toBeNull();
  });

  test("staff（決済なし）は返金対象外・未決済は削除", async () => {
    // paid×2(決済あり) + staff×1(決済なし) = 成立3<4 → 中止。refund は2件のみ。reserved は削除。
    mockState.entries = [paidEntry("a"), paidEntry("b"), paidEntry("staff", false), reservedEntry("r")];
    const r = await forfeitDayIfInsufficient("s1", DATE);
    expect(r).toEqual({ status: "forfeited", paidCount: 3, refundCount: 2 });
    const entrySets = mockState.batchOps.filter((o) => o.op === "set" && o.coll === "mahjongEntries");
    expect(entrySets.map((o) => o.id).sort()).toEqual(["a", "b"]); // staff は返金遷移しない
    const entryDeletes = mockState.batchOps.filter((o) => o.op === "delete" && o.coll === "mahjongEntries");
    expect(entryDeletes.map((o) => o.id)).toEqual(["r"]); // 未決済は削除
    expect(mockSend).toHaveBeenCalledTimes(3); // seated 3名へ通知（staff含む）
  });

  test("create が競合（並行cron）→ already", async () => {
    mockState.createThrows = true;
    mockState.entries = [paidEntry("a"), paidEntry("b")];
    const r = await forfeitDayIfInsufficient("s1", DATE);
    expect(r).toEqual({ status: "already" });
  });
});
