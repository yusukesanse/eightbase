const store = new Map<string, Record<string, unknown>>();
const mockVerify = jest.fn();
const mockRefund = jest.fn();
const mockPayment = jest.fn();
const mockNotify = jest.fn();
const mockAudit = jest.fn();
const mockTransaction = jest.fn();
function docRef(col: string, id: string) {
  const key = `${col}/${id}`;
  return {
    __key: key,
    get: async () => ({ exists: store.has(key), id, data: () => store.get(key) }),
    delete: async () => { store.delete(key); },
  };
}
const mockDb = {
  collection: (col: string) => ({ doc: (id: string) => docRef(col, id) }),
  runTransaction: async (fn: (tx: unknown) => Promise<void>) => {
    await mockTransaction();
    return fn({
      get: (ref: ReturnType<typeof docRef>) => ref.get(),
      update: (ref: ReturnType<typeof docRef>, data: Record<string, unknown>) => {
        store.set(ref.__key, { ...store.get(ref.__key), ...data });
      },
    });
  },
};
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: () => mockDb }));
jest.mock("@/lib/square", () => ({
  verifySquareOrderPayment: (...a: unknown[]) => mockVerify(...a),
  refundSquarePayment: (...a: unknown[]) => mockRefund(...a),
  getSquarePayment: (...a: unknown[]) => mockPayment(...a),
  squareErrorDetail: jest.requireActual("@/lib/square").squareErrorDetail,
}));
jest.mock("@/lib/adminNotify", () => ({ notifyAdmin: (...a: unknown[]) => mockNotify(...a) }));
jest.mock("@/lib/auditLog", () => ({ writeAuditLog: (...a: unknown[]) => mockAudit(...a) }));
import { cancelPaidGameEntryWithRefund as cancel } from "@/lib/gameEntryPayment";
import type { ScoreboardGameId } from "@/types";

function seed(extra: Record<string, unknown> = {}, game: ScoreboardGameId = "mahjong") {
  const entry = { status: "paid", paymentStatus: "paid", paymentAmount: 1500,
    paymentTransactionId: "order-1", eventDate: "2026-10-10", seasonId: "s1",
    lineUserId: "U1", displayName: "利用者", ...extra };
  store.set(`${game}Entries/e1`, entry);
  return entry;
}
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date("2026-09-25T03:00:00Z"));
  store.clear();
  jest.resetAllMocks();
  mockVerify.mockResolvedValue({ orderId: "order-1", paymentId: "pay-1" });
  mockRefund.mockResolvedValue({ refundId: "refund-1", status: "PENDING" });
  mockPayment.mockResolvedValue({ refundedMoney: { amount: BigInt(0) } });
});
afterEach(() => jest.useRealTimers());

describe("cancelPaidGameEntryWithRefund", () => {
  test.each([
    ["当日", { eventDate: "2026-09-25" }, "DEADLINE_PASSED"],
    ["日付なし", { eventDate: undefined }, "DEADLINE_PASSED"],
    ["本人以外", { lineUserId: "other" }, "NOT_OWNER"],
    ["staff免除", { paymentStatus: undefined }, "NOT_PAID"],
    ["未払い", { paymentStatus: "pending" }, "NOT_PAID"],
    ["依頼済み", { status: "cancelRequested" }, "INVALID_TRANSITION"],
  ])("%s は返金せずentry不変", async (_label, extra, kind) => {
    const before = seed(extra as Record<string, unknown>);
    expect(await cancel("mahjong", "e1", "U1")).toEqual({ kind });
    expect(store.get("mahjongEntries/e1")).toEqual(before);
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockRefund).not.toHaveBeenCalled();
  });
  test("存在しないentry", async () => {
    expect(await cancel("mahjong", "none", "U1")).toEqual({ kind: "NOT_FOUND" });
    expect(mockRefund).not.toHaveBeenCalled();
  });
  test.each([1500, 3000])("PENDING成功・実支払額%d円・通知なし", async (amount) => {
    seed({ paymentAmount: amount });
    expect(await cancel("mahjong", "e1", "U1")).toEqual({ kind: "OK" });
    expect(mockVerify).toHaveBeenCalledWith({ orderId: "order-1", expectedAmount: amount, purpose: "mahjong" });
    expect(mockRefund).toHaveBeenCalledWith(expect.objectContaining({ amount, paymentId: "pay-1", purpose: "mahjong" }));
    expect(store.get("mahjongEntries/e1")).toMatchObject({ status: "refunded", paymentStatus: "cancelRequested", squareRefundId: "refund-1", squareRefundStatus: "PENDING", refundMethod: "auto", cancelReason: "self", refundedAt: expect.any(String) });
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ eventType: "entry.autoRefunded", beforeStatus: "paid", afterStatus: "refunded" }));
  });
  test.each(["mahjong", "darts", "billiards", "poker"] as const)("%s COMPLETED成功・月ロック解放", async (game) => {
    seed({}, game);
    store.set(`${game}MonthlyLocks/s1_U1_2026-10`, { eventDate: "2026-10-10" });
    mockRefund.mockResolvedValue({ refundId: "r2", status: "COMPLETED" });
    expect(await cancel(game, "e1", "U1")).toEqual({ kind: "OK" });
    expect(store.get(`${game}Entries/e1`)).toMatchObject({ status: "refunded", paymentStatus: "cancelRequested", squareRefundId: "r2", squareRefundStatus: "COMPLETED" });
    expect(store.has(`${game}MonthlyLocks/s1_U1_2026-10`)).toBe(false);
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ eventType: "entry.autoRefunded", gameCategory: game }));
  });
  test("別日付の月ロックは残す", async () => {
    seed();
    store.set("mahjongMonthlyLocks/s1_U1_2026-10", { eventDate: "2026-10-20" });
    await cancel("mahjong", "e1", "U1");
    expect(store.has("mahjongMonthlyLocks/s1_U1_2026-10")).toBe(true);
  });
  test.each(["exception", "REJECTED", "FAILED", "UNKNOWN"])("%s・返金0はentry不変で管理者通知", async (status) => {
    const before = seed();
    if (status === "exception") mockRefund.mockRejectedValue(new Error("refund failed"));
    else mockRefund.mockResolvedValue({ refundId: "r1", status });
    expect(await cancel("mahjong", "e1", "U1")).toMatchObject({ kind: "REFUND_FAILED" });
    expect(store.get("mahjongEntries/e1")).toEqual(before);
    expect(mockNotify).toHaveBeenCalled();
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ eventType: "entry.autoRefundFailed", beforeStatus: "paid", afterStatus: "paid" }));
  });
  test("REJECTEDでも既に全額返金済みなら復旧", async () => {
    seed();
    mockRefund.mockResolvedValue({ refundId: "r1", status: "REJECTED" });
    mockPayment.mockResolvedValue({ refundedMoney: { amount: BigInt(1500) } });
    expect(await cancel("mahjong", "e1", "U1")).toEqual({ kind: "OK" });
    expect(store.get("mahjongEntries/e1")?.status).toBe("refunded");
    expect(mockNotify).not.toHaveBeenCalled();
  });
  test("返金済み確認が例外ならentry不変", async () => {
    const before = seed();
    mockRefund.mockRejectedValue(new Error("refund"));
    mockPayment.mockRejectedValue(new Error("lookup"));
    expect(await cancel("mahjong", "e1", "U1")).toMatchObject({ kind: "REFUND_FAILED" });
    expect(store.get("mahjongEntries/e1")).toEqual(before);
    expect(mockNotify).toHaveBeenCalled();
  });
  test("refunded再実行はSquareを呼ばない", async () => {
    seed();
    await cancel("mahjong", "e1", "U1");
    mockRefund.mockClear(); mockVerify.mockClear();
    expect(await cancel("mahjong", "e1", "U1")).toEqual({ kind: "OK" });
    expect(mockRefund).not.toHaveBeenCalled();
    expect(mockVerify).not.toHaveBeenCalled();
  });
  test("失敗後の再実行も同じ45文字以下の冪等キー", async () => {
    seed();
    mockRefund.mockRejectedValueOnce(new Error("retry"));
    await cancel("mahjong", "e1", "U1");
    await cancel("mahjong", "e1", "U1");
    const keys = mockRefund.mock.calls.map(([arg]) => arg.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toMatch(/^gr_[a-f0-9]{40}$/);
    expect(keys[0].length).toBeLessThanOrEqual(45);
  });
  test("cancelRejectedの再依頼もrefundedへ反映", async () => {
    seed({ status: "cancelRejected" });
    expect(await cancel("mahjong", "e1", "U1")).toEqual({ kind: "OK" });
    expect(store.get("mahjongEntries/e1")?.status).toBe("refunded");
  });
  test.each(["注文なし", "照合失敗"])("%sはentry不変", async (label) => {
    const before = seed(label === "注文なし" ? { paymentTransactionId: undefined } : {});
    mockVerify.mockRejectedValue(new Error("verify"));
    expect(await cancel("mahjong", "e1", "U1")).toMatchObject({ kind: "REFUND_FAILED" });
    expect(store.get("mahjongEntries/e1")).toEqual(before);
    expect(mockRefund).not.toHaveBeenCalled();
    expect(mockNotify).toHaveBeenCalled();
  });
  test("Square受付後に状態が変わってもrefundedを書く", async () => {
    seed();
    mockRefund.mockImplementation(async () => {
      seed({ status: "cancelRequested" });
      return { refundId: "r1", status: "PENDING" };
    });
    await cancel("mahjong", "e1", "U1");
    expect(store.get("mahjongEntries/e1")?.status).toBe("refunded");
  });
  test("Firestore失敗後の再試行は同じキーで復旧", async () => {
    const before = seed();
    mockTransaction.mockRejectedValueOnce(new Error("write failed"));
    expect(await cancel("mahjong", "e1", "U1")).toEqual({ kind: "REFUND_FAILED", stage: "persist", message: "返金は受け付けましたが、反映に失敗しました。もう一度お試しください。" });
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ eventType: "entry.autoRefundFailed", meta: expect.objectContaining({ stage: "persist", squareRefundId: "refund-1", squareRefundStatus: "PENDING" }) }));
    expect(mockNotify.mock.calls[0][1]).toContain("まず Square の返金履歴を確認してください");
    expect(store.get("mahjongEntries/e1")).toEqual(before);
    expect(await cancel("mahjong", "e1", "U1")).toEqual({ kind: "OK" });
    expect(mockRefund.mock.calls[0][0].idempotencyKey).toBe(mockRefund.mock.calls[1][0].idempotencyKey);
  });
});

test("一部返金1000/1500は復旧せずentry不変・利用者向け固定文言", async () => {
  const before = seed();
  mockRefund.mockResolvedValue({ refundId: "r1", status: "REJECTED" });
  mockPayment.mockResolvedValue({ refundedMoney: { amount: BigInt(1000) } });
  expect(await cancel("mahjong", "e1", "U1")).toEqual({ kind: "REFUND_FAILED", stage: "refund", message: "返金処理に失敗しました。時間をおいて再度お試しいただくか、管理者にお問い合わせください。" });
  expect(store.get("mahjongEntries/e1")).toEqual(before);
});
test("Square例外詳細は管理者通知と監査だけに含める", async () => {
  seed();
  mockRefund.mockRejectedValue({ errors: [{ code: "TEST_REFUND_ERROR" }] });
  const result = await cancel("mahjong", "e1", "U1");
  expect(result).toMatchObject({ kind: "REFUND_FAILED", stage: "refund" });
  expect(JSON.stringify(result)).not.toContain("TEST_REFUND_ERROR");
  expect(mockNotify.mock.calls[0][1]).toContain("TEST_REFUND_ERROR");
  expect(mockNotify.mock.calls[0][1]).toContain("まず Square の返金履歴を確認してください");
  expect(mockAudit.mock.calls[0][0].meta.reason).toContain("TEST_REFUND_ERROR");
});
test("成功監査の失敗は返金成功応答を妨げない", async () => {
  seed();
  mockAudit.mockRejectedValue(new Error("audit unavailable"));
  const error = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await cancel("mahjong", "e1", "U1")).toEqual({ kind: "OK" });
    expect(store.get("mahjongEntries/e1")?.status).toBe("refunded");
  } finally { error.mockRestore(); }
});

test.each(["notify", "audit", "both"])("失敗処理の%s例外でもREFUND_FAILEDを返す", async target => {
  seed(); mockRefund.mockRejectedValue(new Error("refund failed"));
  if (target !== "audit") mockNotify.mockRejectedValueOnce(new Error("notify failed"));
  if (target !== "notify") mockAudit.mockRejectedValueOnce(new Error("audit failed"));
  const error = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(cancel("mahjong", "e1", "U1")).resolves.toMatchObject({ kind: "REFUND_FAILED", stage: "refund" });
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ eventType: "entry.autoRefundFailed" }));
    expect(error).toHaveBeenCalled();
  } finally { error.mockRestore(); }
});
