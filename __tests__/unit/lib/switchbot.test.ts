/**
 * 単体テスト: src/lib/switchbot.ts
 * 認証ヘッダ生成（HMAC署名）とパスコード生成の検証。HTTP は呼ばない。
 */
import { buildAuthHeaders, generatePasscode } from "@/lib/switchbot";

describe("switchbot — 認証ヘッダ buildAuthHeaders", () => {
  const token = "testtoken";
  const secret = "testsecret";
  const t = 1700000000000;
  const nonce = "fixed-nonce";

  test("既知ベクトルと一致する sign（HMAC-SHA256(token+t+nonce, secret) の base64大文字）", () => {
    const h = buildAuthHeaders(token, secret, t, nonce);
    expect(h.sign).toBe("IGHYMQBUZVJ4YZ9V3VIPSMP/UXYTQ398EXZVBHV8TLK=");
  });

  test("ヘッダに Authorization / t / nonce / Content-Type が入る", () => {
    const h = buildAuthHeaders(token, secret, t, nonce);
    expect(h.Authorization).toBe(token);
    expect(h.t).toBe("1700000000000");
    expect(h.nonce).toBe(nonce);
    expect(h["Content-Type"]).toContain("application/json");
  });

  test("sign は大文字（base64を大文字化）", () => {
    const h = buildAuthHeaders(token, secret, t, nonce);
    expect(h.sign).toBe(h.sign.toUpperCase());
  });

  test("nonce が違えば sign も変わる", () => {
    const a = buildAuthHeaders(token, secret, t, "nonce-a");
    const b = buildAuthHeaders(token, secret, t, "nonce-b");
    expect(a.sign).not.toBe(b.sign);
  });
});

describe("switchbot — generatePasscode", () => {
  test("常に6桁の数字文字列（先頭ゼロ許容）", () => {
    for (let i = 0; i < 200; i++) {
      const p = generatePasscode();
      expect(p).toMatch(/^\d{6}$/);
    }
  });

  test("値は 000000〜999999 の範囲", () => {
    for (let i = 0; i < 200; i++) {
      const n = Number(generatePasscode());
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(999999);
    }
  });
});
