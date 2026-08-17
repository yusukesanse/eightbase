/**
 * 単体テスト: POST /api/admin/reservations/[id]/refund
 * 入金済のまま取消された予約を「返金済」として記録する管理API。
 *
 * 検証（完了条件）:
 *  - Square に返金があるときだけ記録する（無ければ 409＝管理操作だけで返金済にしない）
 *  - force:true のときは記録するが refundVerified=false で残す（後から見分けられる）
 *  - 取消されていない予約・未入金の予約は 409（お金の状態を勝手に変えない）
 *  - 二重実行は冪等（alreadyRefunded）
 */
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/adminAuth", () => ({ checkAdminAuth: jest.fn().mockResolvedValue("admin@example.com") }));
jest.mock("@/lib/facilitySecrets", () => ({ getFacilitySquareCredentials: jest.fn().mockResolvedValue(null) }));
jest.mock("@/lib/square", () => ({ getSquarePayment: jest.fn() }));
jest.mock("@/lib/reservationAudit", () => ({ writeReservationAudit: jest.fn().mockResolvedValue(undefined) }));

import { getDb } from "@/lib/firebaseAdmin";
import { getSquarePayment } from "@/lib/square";
import { writeReservationAudit } from "@/lib/reservationAudit";
import { POST } from "@/app/api/admin/reservations/[id]/refund/route";
import type { NextRequest } from "next/server";

type Data = Record<string, unknown>;

function makeDb(initial: Data) {
  const store = new Map<string, Data>([["r1", { ...initial }]]);
  const db = {
    collection: (name: string) => {
      if (name !== "reservations") throw new Error(`unexpected collection: ${name}`);
      return {
        doc: (id: string) => ({
          get: async () => ({ exists: store.has(id), id, data: () => store.get(id) }),
          update: async (d: Data) => store.set(id, { ...(store.get(id) ?? {}), ...d }),
        }),
      };
    },
  };
  return { db, store };
}

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const params = Promise.resolve({ id: "r1" });

const PAID_CANCELLED = {
  facilityId: "trailer",
  paymentAmount: 20000,
  paymentStatus: "completed",
  paymentId: "PAY1",
  status: "cancelled",
};

beforeEach(() => jest.clearAllMocks());

describe("POST /api/admin/reservations/[id]/refund", () => {
  it("Square に返金があれば返金済として記録する（照合済みフラグつき）", async () => {
    const { db, store } = makeDb(PAID_CANCELLED);
    (getDb as jest.Mock).mockReturnValue(db);
    (getSquarePayment as jest.Mock).mockResolvedValue({ refundedMoney: { amount: BigInt(20000) } });

    const res = await POST(req({}), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, verified: true, refundedAmount: 20000 });

    const saved = store.get("r1") as Data;
    expect(saved.paymentStatus).toBe("refunded");
    expect(saved.refundVerified).toBe(true);
    expect(saved.refundProcessedBy).toBe("admin@example.com");
    expect(writeReservationAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "payment.refunded", actor: "admin@example.com" }),
    );
  });

  it("⚠️ Square に返金が無ければ 409 で止め、予約を書き換えない", async () => {
    const { db, store } = makeDb(PAID_CANCELLED);
    (getDb as jest.Mock).mockReturnValue(db);
    (getSquarePayment as jest.Mock).mockResolvedValue({ refundedMoney: { amount: 0 } });

    const res = await POST(req({}), { params });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("REFUND_NOT_FOUND");
    expect((store.get("r1") as Data).paymentStatus).toBe("completed");
  });

  it("force:true なら記録するが refundVerified=false で残す", async () => {
    const { db, store } = makeDb(PAID_CANCELLED);
    (getDb as jest.Mock).mockReturnValue(db);
    (getSquarePayment as jest.Mock).mockRejectedValue(new Error("not found"));

    const res = await POST(req({ force: true }), { params });
    expect(res.status).toBe(200);
    const saved = store.get("r1") as Data;
    expect(saved.paymentStatus).toBe("refunded");
    expect(saved.refundVerified).toBe(false);
  });

  it("⚠️ 旧データ: 照合で入った squarePaymentId でも Square を照合できる", async () => {
    // 決済時の paymentId が無い旧予約。請求管理の「照合」は squarePaymentId に書くので、
    // ここで見ないと返金確認ができず force 記録に落ちてしまう。
    const { db, store } = makeDb({
      facilityId: "trailer",
      paymentAmount: 20000,
      paymentStatus: "completed",
      squarePaymentId: "PAY-FROM-VERIFY",
      status: "cancelled",
    });
    (getDb as jest.Mock).mockReturnValue(db);
    (getSquarePayment as jest.Mock).mockResolvedValue({ refundedMoney: { amount: BigInt(20000) } });

    const res = await POST(req({}), { params });
    expect(res.status).toBe(200);
    expect(getSquarePayment).toHaveBeenCalledWith("PAY-FROM-VERIFY", "reservation", undefined);
    expect((store.get("r1") as Data).refundVerified).toBe(true);
  });

  it("取消されていない予約は 409（先にキャンセルさせる）", async () => {
    const { db, store } = makeDb({ ...PAID_CANCELLED, status: "confirmed" });
    (getDb as jest.Mock).mockReturnValue(db);
    (getSquarePayment as jest.Mock).mockResolvedValue({ refundedMoney: { amount: BigInt(20000) } });

    const res = await POST(req({ force: true }), { params });
    expect(res.status).toBe(409);
    expect((store.get("r1") as Data).paymentStatus).toBe("completed");
  });

  it("未入金の予約は 409", async () => {
    const { db } = makeDb({ ...PAID_CANCELLED, paymentStatus: undefined });
    (getDb as jest.Mock).mockReturnValue(db);

    const res = await POST(req({ force: true }), { params });
    expect(res.status).toBe(409);
    expect(getSquarePayment).not.toHaveBeenCalled();
  });

  it("すでに返金済なら冪等（二重に返金対応しない）", async () => {
    const { db } = makeDb({ ...PAID_CANCELLED, paymentStatus: "refunded" });
    (getDb as jest.Mock).mockReturnValue(db);

    const res = await POST(req({}), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ alreadyRefunded: true });
    expect(writeReservationAudit).not.toHaveBeenCalled();
  });
});
