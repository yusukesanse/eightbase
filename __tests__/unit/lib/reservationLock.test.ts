/**
 * 単体テスト: src/lib/reservations.ts の isLockBlocking / reservationEpochMs
 * （トレーラー pending の TTL解放とSwitchBot有効期間の計算）
 */
import { isLockBlocking, reservationEpochMs } from "@/lib/reservations";

const NOW = "2026-07-01T12:00:00.000Z";

describe("isLockBlocking — TTL対応の占有判定", () => {
  test("cancelled は非ブロッキング", () => {
    expect(isLockBlocking({ status: "cancelled" }, NOW)).toBe(false);
  });

  test("confirmed（pendingExpiresAtなし）はブロッキング", () => {
    expect(isLockBlocking({ status: "confirmed" }, NOW)).toBe(true);
  });

  test("未失効の pending（expires が now より後）はブロッキング", () => {
    expect(
      isLockBlocking({ status: "pending", pendingExpiresAt: "2026-07-01T12:10:00.000Z" }, NOW)
    ).toBe(true);
  });

  test("失効した pending（expires <= now）は非ブロッキング（空き扱い）", () => {
    expect(
      isLockBlocking({ status: "pending", pendingExpiresAt: "2026-07-01T11:50:00.000Z" }, NOW)
    ).toBe(false);
    // ちょうど now も失効扱い
    expect(isLockBlocking({ status: "pending", pendingExpiresAt: NOW }, NOW)).toBe(false);
  });

  test("status 不明・pendingExpiresAtなしは既定でブロッキング（安全側）", () => {
    expect(isLockBlocking({}, NOW)).toBe(true);
  });
});

describe("reservationEpochMs — JSTの日時を epoch ms に", () => {
  test("JSTとして解釈される（+09:00）", () => {
    expect(reservationEpochMs("2026-07-01", "13:00")).toBe(
      new Date("2026-07-01T04:00:00.000Z").getTime()
    );
  });

  test("終了時刻も同様", () => {
    expect(reservationEpochMs("2026-07-01", "15:30")).toBe(
      new Date("2026-07-01T06:30:00.000Z").getTime()
    );
  });
});
