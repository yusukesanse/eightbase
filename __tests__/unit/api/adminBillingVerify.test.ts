/**
 * 単体テスト: POST /api/admin/billing/verify（請求1件を Square に照合する）
 *
 * 検証（完了条件）:
 *  - 注文ID → 決済ID → レシートURL を解決し、決済ID/レシートURLを保存する（次回からリンクで開ける）
 *  - ⚠️ 支払い状態（paymentStatus / status）は**絶対に書き換えない**（照合は読み取り専用）
 *  - 予約は施設ごとの Square 認証情報を優先し、参加費は種目の purpose で問い合わせる
 *  - 注文IDが無い＝Square に記録が無いので 409、Square 側の失敗は 502
 */
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/adminAuth", () => ({ checkAdminAuth: jest.fn().mockResolvedValue("admin@example.com") }));
jest.mock("@/lib/facilitySecrets", () => ({ getFacilitySquareCredentials: jest.fn().mockResolvedValue(null) }));
jest.mock("@/lib/square", () => ({ fetchSquareOrderPayment: jest.fn() }));

import { getDb } from "@/lib/firebaseAdmin";
import { fetchSquareOrderPayment } from "@/lib/square";
import { getFacilitySquareCredentials } from "@/lib/facilitySecrets";
import { POST } from "@/app/api/admin/billing/verify/route";
import type { NextRequest } from "next/server";

type Data = Record<string, unknown>;

function makeDb(collectionName: string, id: string, initial: Data) {
  const store = new Map<string, Data>([[id, { ...initial }]]);
  const db = {
    collection: (name: string) => ({
      doc: (docId: string) => ({
        get: async () => ({ exists: name === collectionName && store.has(docId), data: () => store.get(docId) }),
        update: async (d: Data) => store.set(docId, { ...(store.get(docId) ?? {}), ...d }),
      }),
    }),
  };
  return { db, store };
}

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;

const PAYMENT = {
  status: "COMPLETED",
  amountMoney: { amount: BigInt(3000), currency: "JPY" },
  refundedMoney: { amount: BigInt(0) },
  receiptUrl: "https://squareup.com/receipt/abc",
  createdAt: "2026-08-01T02:00:00Z",
};

beforeEach(() => jest.clearAllMocks());

describe("POST /api/admin/billing/verify", () => {
  it("参加費: 注文ID から決済を解決し、決済ID・レシートURLを保存する", async () => {
    const { db, store } = makeDb("mahjongEntries", "e1", {
      paymentTransactionId: "ORDER1",
      paymentAmount: 3000,
      paymentStatus: "paid",
      status: "paid",
    });
    (getDb as jest.Mock).mockReturnValue(db);
    (fetchSquareOrderPayment as jest.Mock).mockResolvedValue({ orderId: "ORDER1", paymentId: "PAY1", payment: PAYMENT });

    const res = await POST(req({ source: "mahjong", refId: "e1" }));
    expect(res.status).toBe(200);
    expect((await res.json()).payment).toMatchObject({
      paymentId: "PAY1",
      amount: 3000,
      matchesExpected: true,
      completed: true,
      receiptUrl: "https://squareup.com/receipt/abc",
    });

    // 種目の purpose で問い合わせる（用途別アカウントに対応するため）
    expect(fetchSquareOrderPayment).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "ORDER1", purpose: "mahjong" }),
    );

    const saved = store.get("e1") as Data;
    expect(saved.squarePaymentId).toBe("PAY1");
    expect(saved.squareReceiptUrl).toBe("https://squareup.com/receipt/abc");
    // ⚠️ 照合は読み取り専用。支払い状態を動かさない。
    expect(saved.paymentStatus).toBe("paid");
    expect(saved.status).toBe("paid");
  });

  it("予約: 施設ごとの Square 認証情報があればそれを使う", async () => {
    const { db } = makeDb("reservations", "r1", {
      facilityId: "trailer",
      paymentTransactionId: "ORDER2",
      paymentAmount: 20000,
      paymentStatus: "completed",
    });
    (getDb as jest.Mock).mockReturnValue(db);
    (getFacilitySquareCredentials as jest.Mock).mockResolvedValue({
      accessToken: "tok", locationId: "loc", environment: "production",
    });
    (fetchSquareOrderPayment as jest.Mock).mockResolvedValue({
      orderId: "ORDER2",
      paymentId: "PAY2",
      payment: { ...PAYMENT, amountMoney: { amount: BigInt(20000), currency: "JPY" } },
    });

    const res = await POST(req({ source: "reservation", refId: "r1" }));
    expect(res.status).toBe(200);
    expect(fetchSquareOrderPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "reservation",
        credentials: expect.objectContaining({ locationId: "loc" }),
      }),
    );
  });

  it("⚠️ 予約: 既存の paymentId を壊さず、支払い状態も変えない（照合は読み取り専用）", async () => {
    const { db, store } = makeDb("reservations", "r2", {
      facilityId: "trailer",
      paymentTransactionId: "ORDER8",
      paymentAmount: 20000,
      paymentStatus: "completed",
      paymentId: "PAY-ORIGINAL",
      status: "confirmed",
    });
    (getDb as jest.Mock).mockReturnValue(db);
    (getFacilitySquareCredentials as jest.Mock).mockResolvedValue(null);
    (fetchSquareOrderPayment as jest.Mock).mockResolvedValue({
      orderId: "ORDER8",
      paymentId: "PAY-ORIGINAL",
      payment: { ...PAYMENT, amountMoney: { amount: BigInt(20000), currency: "JPY" } },
    });

    await POST(req({ source: "reservation", refId: "r2" }));
    const saved = store.get("r2") as Data;
    expect(saved.paymentId).toBe("PAY-ORIGINAL");
    expect(saved.paymentStatus).toBe("completed");
    expect(saved.status).toBe("confirmed");
  });

  it("未完了(APPROVED)の決済でも参照情報は保存し、状態は呼び出し元へ返す（画面で出し分ける）", async () => {
    const { db, store } = makeDb("billiardsEntries", "e5", {
      paymentTransactionId: "ORDER9",
      paymentAmount: 1500,
      paymentStatus: "pending",
      status: "reserved",
    });
    (getDb as jest.Mock).mockReturnValue(db);
    (fetchSquareOrderPayment as jest.Mock).mockResolvedValue({
      orderId: "ORDER9",
      paymentId: "PAY9",
      payment: { status: "APPROVED", amountMoney: { amount: BigInt(1500), currency: "JPY" } },
    });

    const res = await POST(req({ source: "billiards", refId: "e5" }));
    expect((await res.json()).payment).toMatchObject({ completed: false, status: "APPROVED" });
    const saved = store.get("e5") as Data;
    expect(saved.squarePaymentId).toBe("PAY9");
    // 未完了でも支払い状態は動かさない（ここで paid にすると二重の入口になる）
    expect(saved.paymentStatus).toBe("pending");
    expect(saved.status).toBe("reserved");
  });

  it("記録額と Square の課金額がズレていたら matchesExpected=false で返す", async () => {
    const { db } = makeDb("dartsEntries", "e2", { paymentTransactionId: "ORDER3", paymentAmount: 1000 });
    (getDb as jest.Mock).mockReturnValue(db);
    (fetchSquareOrderPayment as jest.Mock).mockResolvedValue({
      orderId: "ORDER3",
      paymentId: "PAY3",
      payment: { ...PAYMENT, amountMoney: { amount: BigInt(3000), currency: "JPY" } },
    });

    const res = await POST(req({ source: "darts", refId: "e2" }));
    expect((await res.json()).payment.matchesExpected).toBe(false);
  });

  it("注文IDが無ければ 409（Square に記録が無い＝照合しようがない）", async () => {
    const { db } = makeDb("pokerEntries", "e3", { paymentAmount: 2000 });
    (getDb as jest.Mock).mockReturnValue(db);

    const res = await POST(req({ source: "poker", refId: "e3" }));
    expect(res.status).toBe(409);
    expect(fetchSquareOrderPayment).not.toHaveBeenCalled();
  });

  it("Square 側の失敗は 502（アプリのデータは書き換えない）", async () => {
    const { db, store } = makeDb("billiardsEntries", "e4", { paymentTransactionId: "ORDER4", paymentAmount: 1500 });
    (getDb as jest.Mock).mockReturnValue(db);
    (fetchSquareOrderPayment as jest.Mock).mockRejectedValue(new Error("注文が見つかりません"));

    const res = await POST(req({ source: "billiards", refId: "e4" }));
    expect(res.status).toBe(502);
    expect((store.get("e4") as Data).squarePaymentId).toBeUndefined();
  });

  it("source が不正なら 400", async () => {
    (getDb as jest.Mock).mockReturnValue(makeDb("reservations", "r1", {}).db);
    const res = await POST(req({ source: "unknown", refId: "r1" }));
    expect(res.status).toBe(400);
  });
});
