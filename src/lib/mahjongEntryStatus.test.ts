import { canTransition, deriveStatus } from "./mahjongEntryStatus";

describe("麻雀エントリー状態機械", () => {
  it("許可される遷移", () => {
    expect(canTransition("reserved", "paid")).toBe(true);
    expect(canTransition("paid", "cancelRequested")).toBe(true);
    expect(canTransition("cancelRequested", "refunded")).toBe(true);
    expect(canTransition("cancelRequested", "cancelRejected")).toBe(true);
    expect(canTransition("cancelRejected", "cancelRequested")).toBe(true);
  });
  it("拒否される遷移（不正遷移）", () => {
    expect(canTransition("paid", "refunded")).toBe(false); // 依頼を経ずに返金不可
    expect(canTransition("reserved", "cancelRequested")).toBe(false);
    expect(canTransition("refunded", "paid")).toBe(false); // 終端
    expect(canTransition("paid", "paid")).toBe(false);
  });
  it("deriveStatus 後方互換", () => {
    expect(deriveStatus({ status: "refunded" })).toBe("refunded");
    expect(deriveStatus({ paymentStatus: "paid" })).toBe("paid");
    expect(deriveStatus({ paymentStatus: "cancelRequested" })).toBe("cancelRequested");
    expect(deriveStatus({})).toBe("reserved");
  });
});
