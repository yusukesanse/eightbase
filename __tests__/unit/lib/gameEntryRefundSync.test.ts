const store = new Map<string, Record<string, unknown>>();
const mockVerify = jest.fn();
const mockPayment = jest.fn();
const mockAudit = jest.fn();
const mockTransaction = jest.fn();
const mockOrderBy = jest.fn();
const mockWhere = jest.fn();
const mockLimit = jest.fn();
function docRef(col: string, id: string) {
  const key = `${col}/${id}`;
  return { __key: key, get: async () => ({ exists: store.has(key), id, data: () => store.get(key) }),
    delete: async () => { store.delete(key); } };
}
const mockGetAll = jest.fn(async (...refs: ReturnType<typeof docRef>[]) => Promise.all(refs.map(r => r.get())));
const mockDb = {
  collection: (col: string) => ({ doc: (id: string) => docRef(col, id), orderBy: mockOrderBy, where: mockWhere }),
  getAll: mockGetAll,
  runTransaction: async (fn: (tx: unknown) => Promise<void>) => {
    await mockTransaction();
    return fn({ get: (ref: ReturnType<typeof docRef>) => ref.get(),
      update: (ref: ReturnType<typeof docRef>, data: Record<string, unknown>) => {
        store.set(ref.__key, { ...store.get(ref.__key), ...data });
      } });
  },
};
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: () => mockDb }));
// 読み取りだけを公開。refundSquarePaymentを誤って使えば失敗する。
jest.mock("@/lib/square", () => ({
  verifySquareOrderPayment: (...a: unknown[]) => mockVerify(...a),
  getSquarePayment: (...a: unknown[]) => mockPayment(...a),
}));
jest.mock("@/lib/adminNotify", () => ({ notifyAdmin: jest.fn() }));
jest.mock("@/lib/auditLog", () => ({ writeAuditLog: (...a: unknown[]) => mockAudit(...a) }));
import { syncGameEntryRefund as sync, listFailedAutoRefunds } from "@/lib/gameEntryPayment";
import type { ScoreboardGameId } from "@/types";
function seed(extra: Record<string, unknown> = {}, game: ScoreboardGameId = "mahjong", id = "e1") {
  const entry = { status: "paid", paymentStatus: "paid", paymentAmount: 1500,
    paymentTransactionId: "order-1", eventDate: "2026-10-10", seasonId: "s1",
    lineUserId: "U1", displayName: "利用者", ...extra };
  store.set(`${game}Entries/${id}`, entry);
  return entry;
}
function logs(rows: Record<string, unknown>[]) {
  // Firestoreと同じくwhereで絞り込んでからlimitを適用する。旧orderBy経路も再現する。
  const result = (filtered: Record<string, unknown>[]) => ({ limit: (n: number) => {
    mockLimit(n);
    const docs = filtered.slice(0, n).map(data => ({ data: () => data }));
    return { get: async () => ({ docs, size: docs.length }) };
  } });
  mockWhere.mockImplementation((field, op, value) => {
    expect(op).toBe("==");
    return result(rows.filter(row => row[field] === value));
  });
  mockOrderBy.mockImplementation(() => result([...rows].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))));
}
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date("2026-09-25T03:00:00Z"));
  store.clear(); jest.clearAllMocks();
  mockTransaction.mockReset(); mockVerify.mockReset(); mockPayment.mockReset(); mockAudit.mockReset();
  mockVerify.mockResolvedValue({ orderId: "order-1", paymentId: "pay-1" });
  mockPayment.mockResolvedValue({ refundedMoney: { amount: BigInt(1500) } });
  logs([]);
});
afterEach(() => jest.useRealTimers());
test.each(["mahjong", "darts", "billiards", "poker"] as const)("%s 全額返金を同期・月ロック解放・管理者監査", async game => {
  seed({}, game); store.set(`${game}MonthlyLocks/s1_U1_2026-10`, { eventDate: "2026-10-10" });
  expect(await sync(game, "e1", "admin@example.com")).toEqual({ kind: "OK", already: false });
  expect(mockVerify).toHaveBeenCalledWith({ orderId: "order-1", expectedAmount: 1500, purpose: game });
  expect(mockPayment).toHaveBeenCalledWith("pay-1", game);
  expect(store.get(`${game}Entries/e1`)).toMatchObject({ status: "refunded", paymentStatus: "cancelRequested",
    refundMethod: "manualSync", squareRefundStatus: "SYNCED_FULL", squareRefundId: null, cancelReason: "self" });
  expect(store.has(`${game}MonthlyLocks/s1_U1_2026-10`)).toBe(false);
  expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ eventType: "entry.refundSynced", actor: "admin@example.com", gameCategory: game }));
});
test.each([0, 1000])("返金額%dは全額未満なら書き込まない", async amount => {
  const before = seed(); mockPayment.mockResolvedValue({ refundedMoney: { amount: BigInt(amount) } });
  expect(await sync("mahjong", "e1", "admin")).toEqual({ kind: "REFUND_NOT_FOUND" });
  expect(store.get("mahjongEntries/e1")).toEqual(before); expect(mockAudit).not.toHaveBeenCalled();
});
test("既に返金済みはSquare照合不要", async () => {
  seed({ status: "refunded" });
  expect(await sync("mahjong", "e1", "admin")).toEqual({ kind: "OK", already: true });
  expect(mockVerify).not.toHaveBeenCalled(); expect(mockPayment).not.toHaveBeenCalled();
});
test.each(["reserved", "cancelRequested"])("%sは対象外", async status => {
  seed({ status, paymentStatus: status });
  expect(await sync("mahjong", "e1", "admin")).toMatchObject({ kind: "NOT_ELIGIBLE" });
  expect(mockVerify).not.toHaveBeenCalled();
});
test("注文なし", async () => {
  seed({ paymentTransactionId: undefined });
  expect(await sync("mahjong", "e1", "admin")).toMatchObject({ kind: "NOT_ELIGIBLE" });
  expect(mockVerify).not.toHaveBeenCalled();
});
test("不存在", async () => expect(await sync("mahjong", "missing", "admin")).toEqual({ kind: "NOT_FOUND" }));
test.each(["verify", "payment", "persist"] as const)("%s失敗はentry不変", async stage => {
  const before = seed();
  ({ verify: mockVerify, payment: mockPayment, persist: mockTransaction })[stage].mockRejectedValueOnce(new Error("failed"));
  expect(await sync("mahjong", "e1", "admin")).toMatchObject({ kind: stage === "persist" ? "PERSIST_FAILED" : "VERIFY_FAILED" });
  expect(store.get("mahjongEntries/e1")).toEqual(before);
});
test("別開催日の月ロックは解放しない", async () => {
  seed(); store.set("mahjongMonthlyLocks/s1_U1_2026-10", { eventDate: "2026-10-20" });
  await sync("mahjong", "e1", "admin"); expect(store.has("mahjongMonthlyLocks/s1_U1_2026-10")).toBe(true);
});
test("候補は対象種目・失敗ログ・90日以内・現在paidのみ、最新失敗順", async () => {
  for (const id of ["e1", "e2", "other", "old", "unrelated"]) seed({}, "darts", id);
  seed({ status: "refunded" }, "darts", "done");
  const failure = (entryId: string, extra = {}) => ({ eventType: "entry.autoRefundFailed", gameCategory: "darts", createdAt: "2026-09-20T00:00:00Z", target: { entryId }, ...extra });
  logs([failure("e2", { createdAt: "2026-09-24T00:00:00Z" }), failure("e1"), failure("e1"), failure("done"), failure("missing"),
    failure("other", { gameCategory: "poker" }), failure("old", { createdAt: "2026-01-01T00:00:00Z" }),
    failure("unrelated", { eventType: "entry.autoRefunded" })]);
  const result = await listFailedAutoRefunds("darts");
  expect(result.map(e => e.entryId)).toEqual(["e2", "e1"]);
  expect(result[0]).toMatchObject({ failedAt: "2026-09-24T00:00:00Z", amount: 1500, orderId: "order-1" });
  expect(mockWhere).toHaveBeenCalledWith("eventType", "==", "entry.autoRefundFailed");
  expect(mockOrderBy).not.toHaveBeenCalled(); expect(mockLimit).toHaveBeenCalledWith(500);
  expect(mockGetAll.mock.calls[0].map(r => r.__key)).toEqual(["dartsEntries/e2", "dartsEntries/e1", "dartsEntries/done", "dartsEntries/missing"]);
});
test("種目未設定は麻雀・200候補上限", async () => {
  logs(Array.from({ length: 201 }, (_, i) => {
    seed({}, "mahjong", `e${i}`);
    return { eventType: "entry.autoRefundFailed", createdAt: "2026-09-20T00:00:00Z", target: { entryId: `e${i}` } };
  }));
  expect(await listFailedAutoRefunds("mahjong")).toHaveLength(200);
  expect(mockGetAll.mock.calls[0]).toHaveLength(200);
});
test("候補なしならgetAllしない", async () => {
  expect(await listFailedAutoRefunds("mahjong")).toEqual([]); expect(mockGetAll).not.toHaveBeenCalled();
});

test.each(["mahjong", "darts", "billiards", "poker"] as const)("%s cancelRejectedの失敗を一覧から同期できる", async game => {
  seed({ status: "cancelRejected", paymentStatus: "paid" }, game);
  logs([{ eventType: "entry.autoRefundFailed", gameCategory: game, createdAt: "2026-09-20T00:00:00Z", target: { entryId: "e1" } }]);
  expect(await listFailedAutoRefunds(game)).toEqual([expect.objectContaining({ entryId: "e1" })]);
  expect(await sync(game, "e1", "admin")).toEqual({ kind: "OK", already: false });
  expect(store.get(`${game}Entries/e1`)?.status).toBe("refunded");
});
test("大量の別イベントに失敗ログが埋もれない", async () => {
  seed();
  logs([...Array.from({ length: 900 }, () => ({ eventType: "entry.autoRefunded", createdAt: "2026-09-24T00:00:00Z" })),
    { eventType: "entry.autoRefundFailed", createdAt: "2026-09-20T00:00:00Z", target: { entryId: "e1" } }]);
  expect(await listFailedAutoRefunds("mahjong")).toHaveLength(1);
  expect(mockWhere).toHaveBeenCalledWith("eventType", "==", "entry.autoRefundFailed");
  expect(mockOrderBy).not.toHaveBeenCalled();
});
test.each([499, 500])("取得%d件で上限到達時だけ警告", async count => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  try {
    logs(Array.from({ length: count }, () => ({ eventType: "entry.autoRefundFailed" })));
    await listFailedAutoRefunds("mahjong");
    expect(warn).toHaveBeenCalledTimes(count === 500 ? 1 : 0);
  } finally { warn.mockRestore(); }
});
test("tx到達時に別プロセスが返金済みなら同期監査を追加しない", async () => {
  seed();
  mockTransaction.mockImplementationOnce(() => { seed({ status: "refunded", refundMethod: "auto" }); });
  expect(await sync("mahjong", "e1", "admin")).toEqual({ kind: "OK", already: true });
  expect(mockPayment).toHaveBeenCalled();
  expect(mockAudit).not.toHaveBeenCalled();
  expect(store.get("mahjongEntries/e1")?.refundMethod).toBe("auto");
});
test.each([{ refundIds: ["refund-xyz"] }, { refundIds: [] }, { refundIds: undefined }])("Square返金ID $refundIds を保存", async ({ refundIds }) => {
  seed();
  mockPayment.mockResolvedValue({ refundedMoney: { amount: BigInt(1500) }, refundIds });
  expect(await sync("mahjong", "e1", "admin")).toEqual({ kind: "OK", already: false });
  expect(store.get("mahjongEntries/e1")?.squareRefundId).toBe(refundIds?.[0] ?? null);
});
test("同期監査が失敗しても記録成功を返す", async () => {
  seed(); mockAudit.mockRejectedValueOnce(new Error("audit unavailable"));
  const error = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(sync("mahjong", "e1", "admin")).resolves.toEqual({ kind: "OK", already: false });
    expect(store.get("mahjongEntries/e1")?.status).toBe("refunded");
    expect(error).toHaveBeenCalled();
  } finally { error.mockRestore(); }
});

test.each(["mahjong", "darts", "billiards", "poker"] as const)("%s cancelRejectedを直接同期できる", async game => {
  seed({ status: "cancelRejected", paymentStatus: "paid" }, game);
  expect(await sync(game, "e1", "admin")).toEqual({ kind: "OK", already: false });
  expect(store.get(`${game}Entries/e1`)?.status).toBe("refunded");
});
