/**
 * 単体テスト: src/lib/gameEntryPayment.ts
 *
 * 背景（2026-08-03 本番障害）:
 *   ゲストが参加費を払ったのに確定処理へ到達できず、Square では課金済みなのに
 *   エントリーが未払いのまま残った。仮押さえTTL(15分)を過ぎると利用者側では復旧できないため、
 *   管理者が「Squareの入金を照合して支払い済みに戻す」経路を用意した。
 *
 * ここで固定する安全性:
 *   - **Square で入金が確認できなければ絶対に paid にしない**（管理操作だけで未払いを消せない）
 *   - 返金として記録済みの注文は着席させない（返金と参加の二重取り防止）
 *   - 当日名簿の paid にも反映する（払ったのに進行に入れない、を起こさない）
 */
const store = new Map<string, Record<string, unknown>>();
const mockVerify = jest.fn();
const mockAudit = jest.fn();

function docRef(col: string, id: string) {
  const key = `${col}/${id}`;
  return {
    __key: key,
    get: async () => ({ exists: store.has(key), id, data: () => store.get(key) }),
  };
}

const mockDb = {
  collection: (col: string) => ({
    doc: (id: string) => docRef(col, id),
    where: (field: string, _op: string, value: unknown) => ({
      get: async () => ({
        docs: [...store.entries()]
          .filter(([k, v]) => k.startsWith(`${col}/`) && v[field] === value)
          .map(([k, v]) => ({ id: k.split("/")[1], data: () => v })),
      }),
    }),
  }),
  runTransaction: async <T>(fn: (tx: unknown) => Promise<T>) => {
    const tx = {
      get: async (ref: { __key: string; get: () => Promise<unknown> }) => ref.get(),
      set: (ref: { __key: string }, data: Record<string, unknown>, opts?: { merge?: boolean }) => {
        store.set(ref.__key, opts?.merge ? { ...(store.get(ref.__key) ?? {}), ...data } : data);
      },
      update: (ref: { __key: string }, data: Record<string, unknown>) => {
        store.set(ref.__key, { ...(store.get(ref.__key) ?? {}), ...data });
      },
    };
    return fn(tx);
  },
};

jest.mock("@/lib/firebaseAdmin", () => ({ getDb: () => mockDb }));
jest.mock("@/lib/square", () => ({ verifySquareOrderPayment: (...a: unknown[]) => mockVerify(...a) }));
jest.mock("@/lib/auditLog", () => ({ writeAuditLog: (...a: unknown[]) => mockAudit(...a) }));

import { markGameEntryPaid, listUnconfirmedPayments } from "@/lib/gameEntryPayment";

const ENTRY = "dartsEntries/e1";
const DAY = "dartsDayState/s1_2026-08-06";

function seedPendingEntry(extra: Record<string, unknown> = {}) {
  store.clear();
  store.set(ENTRY, {
    eventDate: "2026-08-06",
    displayName: "ゲスト太郎",
    lineUserId: "U_guest",
    seasonId: "s1",
    paymentStatus: "pending",
    paymentAmount: 1000,
    paymentTransactionId: "order-1",
    pendingExpiresAt: "2020-01-01T00:00:00.000Z", // TTL切れ＝利用者側では復旧不能
    ...extra,
  });
}

beforeEach(() => {
  store.clear();
  mockVerify.mockReset().mockResolvedValue({ orderId: "order-1", paymentId: "pay-1" });
  mockAudit.mockReset().mockResolvedValue(undefined);
});

describe("markGameEntryPaid の安全性", () => {
  test("Squareで入金が確認できなければ paid にしない（何も書き換えない）", async () => {
    seedPendingEntry();
    mockVerify.mockRejectedValueOnce(new Error("order not paid"));

    const r = await markGameEntryPaid("darts", "e1", "admin@example.com");

    expect(r).toMatchObject({ ok: false, code: "VERIFY_FAILED" });
    expect(store.get(ENTRY)!.paymentStatus).toBe("pending"); // 変わっていない
    expect(mockAudit).not.toHaveBeenCalled();
  });

  test("返金として記録済みの注文は支払い済みにしない（二重取り防止）", async () => {
    seedPendingEntry();
    store.set("squareOrders/order-1", { refundPending: true });

    const r = await markGameEntryPaid("darts", "e1", "admin@example.com");

    expect(r).toMatchObject({ ok: false, code: "ORDER_CONSUMED" });
    expect(store.get(ENTRY)!.paymentStatus).toBe("pending");
  });

  test("期限切れ返金として記録済みでも支払い済みにしない", async () => {
    seedPendingEntry();
    store.set("squareOrders/order-1", { expiredRefund: true });
    expect(await markGameEntryPaid("darts", "e1", "a@b.c")).toMatchObject({ code: "ORDER_CONSUMED" });
  });

  test("決済リンク未発行（注文が無い）ものは対象外", async () => {
    seedPendingEntry({ paymentTransactionId: undefined });
    const r = await markGameEntryPaid("darts", "e1", "a@b.c");
    expect(r).toMatchObject({ ok: false, code: "NO_ORDER" });
    expect(mockVerify).not.toHaveBeenCalled();
  });

  test("キャンセル依頼中は支払い済みにしない（返金対応の領域）", async () => {
    seedPendingEntry({ paymentStatus: "cancelRequested" });
    expect(await markGameEntryPaid("darts", "e1", "a@b.c")).toMatchObject({ ok: false, code: "INVALID_STATE" });
  });

  test("存在しないエントリーは NOT_FOUND", async () => {
    store.clear();
    expect(await markGameEntryPaid("darts", "nope", "a@b.c")).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("markGameEntryPaid の正常系", () => {
  test("入金が確認できれば paid にし、当日名簿にも反映する", async () => {
    seedPendingEntry();
    // 当日名簿に「未払い」で載っている状態（＝進行に参加できない）
    store.set(DAY, {
      participants: [
        { lineUserId: "U_guest", paid: false },
        { lineUserId: "U_other", paid: true },
      ],
    });

    const r = await markGameEntryPaid("darts", "e1", "admin@example.com");

    expect(r).toMatchObject({ ok: true, alreadyPaid: false });
    const entry = store.get(ENTRY)!;
    expect(entry.paymentStatus).toBe("paid");
    expect(entry.status).toBe("paid");
    expect(entry.markedPaidBy).toBe("admin@example.com");

    // 当日名簿の当人だけ paid=true になる
    const day = store.get(DAY) as { participants: { lineUserId: string; paid: boolean }[] };
    expect(day.participants).toEqual([
      { lineUserId: "U_guest", paid: true },
      { lineUserId: "U_other", paid: true },
    ]);

    // 監査ログに残る
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "payment.markedPaid", gameCategory: "darts", actor: "admin@example.com" })
    );
  });

  test("当日名簿がまだ無くても（開始前）エントリーは paid になる", async () => {
    seedPendingEntry();
    const r = await markGameEntryPaid("darts", "e1", "a@b.c");
    expect(r).toMatchObject({ ok: true });
    expect(store.get(ENTRY)!.paymentStatus).toBe("paid");
  });

  test("既に支払い済みなら冪等に成功（二重処理しない）", async () => {
    seedPendingEntry({ paymentStatus: "paid" });
    const r = await markGameEntryPaid("darts", "e1", "a@b.c");
    expect(r).toMatchObject({ ok: true, alreadyPaid: true });
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });
});

describe("listUnconfirmedPayments", () => {
  test("未払い かつ 決済リンク発行済み だけを候補に出す", async () => {
    store.clear();
    store.set("dartsEntries/paid1", { paymentStatus: "paid", paymentTransactionId: "o1" });
    store.set("dartsEntries/noorder", { paymentStatus: "pending", eventDate: "2026-08-06" });
    store.set("dartsEntries/target", {
      paymentStatus: "pending", paymentTransactionId: "o2",
      eventDate: "2026-08-06", displayName: "ゲスト太郎", lineUserId: "U1",
      paymentAmount: 1000, pendingExpiresAt: "2020-01-01T00:00:00.000Z",
    });

    const items = await listUnconfirmedPayments("darts");

    expect(items.map((i) => i.entryId)).toEqual(["target"]);
    expect(items[0]).toMatchObject({ displayName: "ゲスト太郎", amount: 1000, orderId: "o2", expired: true });
  });
});
