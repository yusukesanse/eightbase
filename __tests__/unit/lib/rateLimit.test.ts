/**
 * 単体テスト: src/lib/rateLimit.ts
 * レートリミッター機能のテスト
 */
import {
  checkRateLimit,
  getClientIp,
  recordFailure,
  isBlockedByFailures,
  resetRateLimit,
} from "@/lib/rateLimit";

describe("rateLimit — レートリミッター", () => {
  // UT-RL-001: 初回リクエストはOK
  test("初回リクエストは許可される", () => {
    const result = checkRateLimit("test-ip-001", 5, 60000);
    expect(result).toBe(true);
  });

  // UT-RL-002: 上限内のリクエストはOK
  test("上限内のリクエストは全て許可される", () => {
    const key = "test-ip-002";
    const max = 3;
    for (let i = 0; i < max; i++) {
      expect(checkRateLimit(key, max, 60000)).toBe(true);
    }
  });

  // UT-RL-003: 上限を超えるとブロック
  test("上限を超えるとブロックされる", () => {
    const key = "test-ip-003";
    const max = 2;
    expect(checkRateLimit(key, max, 60000)).toBe(true);
    expect(checkRateLimit(key, max, 60000)).toBe(true);
    expect(checkRateLimit(key, max, 60000)).toBe(false);
  });

  // UT-RL-004: 異なるキーは独立
  test("異なるキーは独立してカウントされる", () => {
    const max = 1;
    expect(checkRateLimit("ip-A", max, 60000)).toBe(true);
    expect(checkRateLimit("ip-B", max, 60000)).toBe(true);
    expect(checkRateLimit("ip-A", max, 60000)).toBe(false);
    expect(checkRateLimit("ip-B", max, 60000)).toBe(false);
  });

  // UT-RL-005: ウィンドウ期限切れ後はリセット
  test("ウィンドウ期限後はカウントがリセットされる", () => {
    const key = "test-ip-005";
    const max = 1;
    const windowMs = 100; // 100ms

    expect(checkRateLimit(key, max, windowMs)).toBe(true);
    expect(checkRateLimit(key, max, windowMs)).toBe(false);

    // 待機して期限切れにする
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(checkRateLimit(key, max, windowMs)).toBe(true);
        resolve();
      }, 150);
    });
  });
});

describe("failure-based ブロック（招待コードhash単位の総当たり対策）", () => {
  // UT-RL-101: 失敗が閾値未満ならブロックされない
  test("失敗回数が閾値未満なら isBlockedByFailures は false", () => {
    const key = "fail-key-101";
    recordFailure(key, 60000);
    recordFailure(key, 60000);
    expect(isBlockedByFailures(key, 5)).toBe(false);
  });

  // UT-RL-102: 失敗が閾値以上でブロック
  test("失敗回数が閾値以上で isBlockedByFailures は true", () => {
    const key = "fail-key-102";
    for (let i = 0; i < 5; i++) recordFailure(key, 60000);
    expect(isBlockedByFailures(key, 5)).toBe(true);
  });

  // UT-RL-103: recordFailure は現在の失敗回数を返す
  test("recordFailure は加算後の失敗回数を返す", () => {
    const key = "fail-key-103";
    expect(recordFailure(key, 60000)).toBe(1);
    expect(recordFailure(key, 60000)).toBe(2);
    expect(recordFailure(key, 60000)).toBe(3);
  });

  // UT-RL-104: 失敗カウンタと通常カウンタは独立（名前空間分離）
  test("失敗カウンタは checkRateLimit のカウンタと独立している", () => {
    const key = "fail-key-104";
    // 通常カウンタを使い切っても失敗カウンタには影響しない
    checkRateLimit(key, 1, 60000);
    checkRateLimit(key, 1, 60000);
    expect(isBlockedByFailures(key, 1)).toBe(false);
    recordFailure(key, 60000);
    expect(isBlockedByFailures(key, 1)).toBe(true);
  });

  // UT-RL-105: reset で失敗カウンタもクリアされる
  test("resetRateLimit で失敗カウンタがクリアされる", () => {
    const key = "fail-key-105";
    for (let i = 0; i < 3; i++) recordFailure(key, 60000);
    expect(isBlockedByFailures(key, 3)).toBe(true);
    resetRateLimit(key);
    expect(isBlockedByFailures(key, 3)).toBe(false);
  });

  // UT-RL-106: 窓の期限切れで失敗回数がリセットされる
  test("窓の期限後は失敗回数がリセットされる", () => {
    const key = "fail-key-106";
    recordFailure(key, 100);
    recordFailure(key, 100);
    expect(isBlockedByFailures(key, 2)).toBe(true);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(isBlockedByFailures(key, 2)).toBe(false);
        expect(recordFailure(key, 100)).toBe(1); // 新しい窓で1から
        resolve();
      }, 150);
    });
  });
});

describe("getClientIp — IPアドレス取得", () => {
  // UT-RL-006: x-forwarded-forからIP取得
  test("x-forwarded-forヘッダーからIPを取得する", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "192.168.1.1, 10.0.0.1" },
    });
    expect(getClientIp(req)).toBe("192.168.1.1");
  });

  // UT-RL-007: ヘッダーなしはunknown
  test("ヘッダーがない場合は'unknown'を返す", () => {
    const req = new Request("http://localhost");
    expect(getClientIp(req)).toBe("unknown");
  });

  // UT-RL-008: 単一IPのx-forwarded-for
  test("単一IPのx-forwarded-forを正しく処理する", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "203.0.113.50" },
    });
    expect(getClientIp(req)).toBe("203.0.113.50");
  });
});
