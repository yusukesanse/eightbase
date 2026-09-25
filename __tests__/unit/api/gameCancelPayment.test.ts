import { NextRequest } from "next/server";
const mockCancel = jest.fn();
let mockEntry: Record<string, unknown> | undefined;
jest.mock("@/lib/gameEntryPayment", () => ({ cancelPaidGameEntryWithRefund: (...a: unknown[]) => mockCancel(...a) }));
jest.mock("@/lib/auth", () => ({ requireGameUserWithRole: async () => ({ lineUserId: "U1" }) }));
jest.mock("@/lib/mahjong", () => ({ getActiveSeason: async () => ({ seasonId: "s1" }) }));
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: () => ({ collection: () => ({ doc: () => ({
  get: async () => ({ exists: !!mockEntry, data: () => mockEntry }),
}) }) }) }));
jest.mock("@/lib/adminNotify", () => ({ notifyAdmin: jest.fn() }));
jest.mock("@/lib/auditLog", () => ({ writeAuditLog: jest.fn() }));
import { POST as mahjong } from "@/app/api/mahjong/entries/cancel-payment/route";
import { POST as darts } from "@/app/api/darts/entries/cancel-payment/route";
import { POST as billiards } from "@/app/api/billiards/entries/cancel-payment/route";
import { POST as poker } from "@/app/api/poker/entries/cancel-payment/route";
import { MAHJONG_CANCEL_POLICY } from "@/lib/date";
const request = () => new NextRequest("http://localhost/api/game/entries/cancel-payment", { method: "POST", body: JSON.stringify({ eventDate: "2026-10-10" }) });
beforeEach(() => {
  jest.clearAllMocks();
  mockEntry = { lineUserId: "U1", status: "paid", paymentStatus: "paid" };
  mockCancel.mockResolvedValue({ kind: "OK" });
});
describe.each([["mahjong", mahjong], ["darts", darts], ["billiards", billiards], ["poker", poker]] as const)("%s cancel-payment", (game, post) => {
  test("共通libを呼んで成功応答", async () => {
    const res = await post(request());
    expect(mockCancel).toHaveBeenCalledWith(game, "s1_2026-10-10_U1", "U1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });
  test.each([
    ["NOT_FOUND", 404, { error: "参加表明が見つかりません" }],
    ["NOT_OWNER", 400, { error: "NOT_OWNER", message: "対象の参加表明が見つかりません。" }],
    ["NOT_PAID", 400, { error: "NOT_PAID", message: "お支払い済みの参加費のみキャンセルできます。" }],
    ["DEADLINE_PASSED", 409, { error: "DEADLINE_PASSED", message: MAHJONG_CANCEL_POLICY }],
    ["INVALID_TRANSITION", 409, { error: "INVALID_TRANSITION", message: "現在の状態ではキャンセルできません。" }],
    ["REFUND_FAILED", 502, { error: "REFUND_FAILED", message: "internal detail" }],
  ])("既存エラー応答契約 %s", async (kind, status, body) => {
    mockCancel.mockResolvedValue({ kind, message: "internal detail", stage: "refund" });
    const res = await post(request());
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(body);
  });
});
test("darts旧cancelRequestedは本人のみalready成功・lib未呼出", async () => {
  mockEntry = { lineUserId: "U1", status: "cancelRequested" };
  expect(await (await darts(request())).json()).toEqual({ success: true, already: true });
  expect(mockCancel).not.toHaveBeenCalled();
  mockEntry.lineUserId = "other";
  const res = await darts(request());
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "NOT_OWNER", message: "対象の参加表明が見つかりません。" });
});
test("darts事前取得で不存在は従来の404", async () => {
  mockEntry = undefined;
  const res = await darts(request());
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "参加表明が見つかりません" });
  expect(mockCancel).not.toHaveBeenCalled();
});
