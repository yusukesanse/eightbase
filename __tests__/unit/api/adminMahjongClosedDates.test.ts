jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/adminAuth", () => ({ checkAdminAuth: async () => "admin" }));
jest.mock("@/lib/auditLog", () => ({ writeAuditLog: jest.fn() }));
import { NextRequest } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { POST } from "@/app/api/admin/mahjong/closed-dates/route";
import { makeDb } from "../../helpers/scheduleDb";
test("休催化のpaid件数は返金済みを除外する", async () => {
  const db = makeDb();
  (getDb as jest.Mock).mockReturnValue(db);
  for (const [id, status, paymentStatus] of [["paid", "paid", "paid"], ["refunded", "refunded", "paid"], ["unpaid", "reserved", "pending"]]) {
    db.__set("mahjongEntries", id, { eventDate: "2026-10-10", status, paymentStatus });
  }
  const res = await POST(new NextRequest("http://localhost/api/admin/mahjong/closed-dates", { method: "POST", body: JSON.stringify({ date: "2026-10-10" }) }));
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ affected: { total: 3, paid: 1 } });
});
