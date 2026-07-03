/**
 * 単体テスト: src/lib/mahjongPayment.ts
 * 麻雀参加費決済のクライアントヘルパー（fetch をモックしてリクエスト形と結果マッピングを検証）。
 */
import {
  startEntryPayment,
  completeEntryPayment,
  cancelEntryPayment,
} from "@/lib/mahjongPayment";

function mockFetch(status: number, body: unknown) {
  const fn = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe("mahjongPayment — 参加費決済クライアント", () => {
  afterEach(() => jest.restoreAllMocks());

  test("startEntryPayment: 成功で paymentUrl を返し、pay API へ eventDate を POST", async () => {
    const fn = mockFetch(200, { entryId: "e1", paymentUrl: "https://sq/pay" });
    const r = await startEntryPayment("2026-08-08");
    expect(r).toEqual({ ok: true, paymentUrl: "https://sq/pay" });
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe("/api/mahjong/entries/pay");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ eventDate: "2026-08-08" });
  });

  test("startEntryPayment: エラーは message を伝播（NOT_TODAY 等）", async () => {
    mockFetch(400, { error: "NOT_TODAY", message: "開催当日のみ可能です。" });
    const r = await startEntryPayment("2026-08-08");
    expect(r).toEqual({ ok: false, message: "開催当日のみ可能です。" });
  });

  test("startEntryPayment: paymentUrl 欠落は失敗扱い", async () => {
    mockFetch(200, {});
    const r = await startEntryPayment("2026-08-08");
    expect(r.ok).toBe(false);
  });

  test("completeEntryPayment: paid=true で成功、alreadyDone を反映", async () => {
    mockFetch(200, { paid: true, entryId: "e1", alreadyDone: true });
    const r = await completeEntryPayment("e1");
    expect(r).toEqual({ ok: true, alreadyDone: true });
  });

  test("completeEntryPayment: 再利用（409）は失敗", async () => {
    mockFetch(409, { error: "PAYMENT_REUSED", message: "この決済はすでに使用されています。" });
    const r = await completeEntryPayment("e1");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("使用");
  });

  test("cancelEntryPayment: 成功で ok、eventDate を POST", async () => {
    const fn = mockFetch(200, { success: true });
    const r = await cancelEntryPayment("2026-08-08");
    expect(r.ok).toBe(true);
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe("/api/mahjong/entries/cancel-payment");
    expect(JSON.parse(init.body)).toEqual({ eventDate: "2026-08-08" });
  });

  test("cancelEntryPayment: NOT_PAID は失敗メッセージ", async () => {
    mockFetch(400, { error: "NOT_PAID", message: "お支払い済みの参加費のみキャンセルできます。" });
    const r = await cancelEntryPayment("2026-08-08");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("キャンセル");
  });
});
