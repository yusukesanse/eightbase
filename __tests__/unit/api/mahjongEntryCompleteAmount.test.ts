jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/auth", () => ({ requireGameUserWithRole: async () => ({ lineUserId: "U1" }) }));
jest.mock("@/lib/adminNotify", () => ({ notifyAdmin: jest.fn() }));
jest.mock("@/lib/square", () => ({ verifySquareOrderPayment: jest.fn() }));
import { getDb } from "@/lib/firebaseAdmin";
import { verifySquareOrderPayment } from "@/lib/square";
import { POST } from "@/app/api/mahjong/entries/complete/route";
import { makeDb } from "../../helpers/scheduleDb";
import type { NextRequest } from "next/server";
test.each([3000, 5000])("保存額5000と支払額%sを照合", async (paidAmount) => {
  const db = makeDb(); (getDb as jest.Mock).mockReturnValue(db);
  db.__set("mahjongEntries", "entry1", { lineUserId: "U1", paymentStatus: "pending", paymentAmount: 5000, paymentTransactionId: "ORDER", pendingExpiresAt: "2999-01-01T00:00:00Z" });
  (verifySquareOrderPayment as jest.Mock).mockReset().mockImplementation(async ({ expectedAmount }) => {
    if (paidAmount !== expectedAmount) throw new Error("金額不一致");
    return { orderId: "ORDER", paymentId: "PAY" };
  });
  const res = await POST({ json: async () => ({ rid: "entry1" }) } as NextRequest);
  expect(verifySquareOrderPayment).toHaveBeenCalledWith({ orderId: "ORDER", expectedAmount: 5000 });
  expect(res.status).toBe(paidAmount === 5000 ? 200 : 402);
  expect(db.__get("mahjongEntries", "entry1")?.paymentStatus).toBe(paidAmount === 5000 ? "paid" : "pending");
});
