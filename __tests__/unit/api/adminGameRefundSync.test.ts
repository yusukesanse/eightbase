import { NextRequest } from "next/server";
const mockAuth = jest.fn();
const mockSync = jest.fn();
const mockList = jest.fn();
jest.mock("@/lib/adminAuth", () => ({ checkAdminAuth: (...a: unknown[]) => mockAuth(...a) }));
jest.mock("@/lib/gameEntryPayment", () => ({
  isPaymentGame: (v: unknown) => ["mahjong", "darts", "billiards", "poker"].includes(v as string),
  syncGameEntryRefund: (...a: unknown[]) => mockSync(...a),
  listFailedAutoRefunds: (...a: unknown[]) => mockList(...a),
}));
import { GET, POST } from "@/app/api/admin/games/refund-sync/route";
const get = (game = "darts") => new NextRequest(`http://localhost/api/admin/games/refund-sync?game=${game}`);
const post = (body: unknown = { game: "darts", entryId: "e_1-2" }) => new NextRequest("http://localhost/api/admin/games/refund-sync", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { jest.resetAllMocks(); mockAuth.mockResolvedValue("admin@example.com"); });
test("GET/POSTとも管理者以外401", async () => {
  mockAuth.mockResolvedValue(null);
  for (const res of [await GET(get()), await POST(post())]) {
    expect(res.status).toBe(401); expect(await res.json()).toEqual({ error: "Unauthorized" });
  }
  expect(mockList).not.toHaveBeenCalled(); expect(mockSync).not.toHaveBeenCalled();
});
test("GET一覧", async () => {
  mockList.mockResolvedValue([{ entryId: "e1" }]); const res = await GET(get());
  expect(res.status).toBe(200); expect(await res.json()).toEqual({ items: [{ entryId: "e1" }] });
  expect(mockList).toHaveBeenCalledWith("darts");
});
test("GET不正game", async () => expect((await GET(get("bad"))).status).toBe(400));
test.each([{ game: "bad", entryId: "e1" }, { game: "darts", entryId: "a/b" }, { game: "darts" }, { game: "darts", entryId: 12 }, null])("POST不正body %j", async body => {
  expect((await POST(post(body))).status).toBe(400); expect(mockSync).not.toHaveBeenCalled();
});
test.each([
  [{ kind: "NOT_FOUND" }, 404, { error: "参加表明が見つかりません" }],
  [{ kind: "NOT_ELIGIBLE", message: "対象外" }, 409, { error: "NOT_ELIGIBLE", message: "対象外" }],
  [{ kind: "REFUND_NOT_FOUND" }, 409, { error: "REFUND_NOT_FOUND", message: "Squareで全額返金が確認できません" }],
  [{ kind: "VERIFY_FAILED", message: "照合失敗" }, 502, { error: "VERIFY_FAILED", message: "照合失敗" }],
  [{ kind: "PERSIST_FAILED", message: "反映失敗" }, 502, { error: "PERSIST_FAILED", message: "反映失敗" }],
  [{ kind: "OK", already: false }, 200, { success: true, already: false }],
  [{ kind: "OK", already: true }, 200, { success: true, already: true }],
])("POST結果 %j", async (result, status, expected) => {
  mockSync.mockResolvedValue(result); const res = await POST(post());
  expect(res.status).toBe(status); expect(await res.json()).toEqual(expected);
  expect(mockSync).toHaveBeenCalledWith("darts", "e_1-2", "admin@example.com");
});
test("GET/POST予期しない例外500", async () => {
  mockList.mockRejectedValue(new Error("unexpected")); mockSync.mockRejectedValue(new Error("unexpected"));
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    for (const res of [await GET(get()), await POST(post())]) {
      expect(res.status).toBe(500); expect(await res.json()).toEqual({ error: "処理に失敗しました" });
    }
  } finally { spy.mockRestore(); }
});
