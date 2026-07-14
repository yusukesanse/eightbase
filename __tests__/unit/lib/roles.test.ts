/**
 * 単体テスト: src/lib/roles.ts
 * 参加者種別（member/guest/staff）の判定ヘルパー。
 */
import {
  normalizeRole,
  isGamesOnlyRole,
  usesUrlInvite,
  mahjongPaymentRequired,
  ROLE_LABELS,
} from "@/lib/roles";

describe("roles — 参加者種別ヘルパー", () => {
  test("normalizeRole: 既知はそのまま、未知/未設定は member", () => {
    expect(normalizeRole("member")).toBe("member");
    expect(normalizeRole("guest")).toBe("guest");
    expect(normalizeRole("staff")).toBe("staff");
    expect(normalizeRole(undefined)).toBe("member");
    expect(normalizeRole("")).toBe("member");
    expect(normalizeRole("visitor")).toBe("member"); // 旧/未知は会員扱い
  });

  test("isGamesOnlyRole: guest のみ true（staff は会員同等に拡大・member は全機能）", () => {
    expect(isGamesOnlyRole("guest")).toBe(true);
    expect(isGamesOnlyRole("staff")).toBe(false);
    expect(isGamesOnlyRole("member")).toBe(false);
    expect(isGamesOnlyRole(undefined)).toBe(false);
  });

  test("usesUrlInvite: guest と staff は URL 招待（member は OTP）", () => {
    expect(usesUrlInvite("guest")).toBe(true);
    expect(usesUrlInvite("staff")).toBe(true);
    expect(usesUrlInvite("member")).toBe(false);
    expect(usesUrlInvite(undefined)).toBe(false);
  });

  test("mahjongPaymentRequired: 会員/ゲストは要、エイト社員(staff)は不要", () => {
    expect(mahjongPaymentRequired("member")).toBe(true);
    expect(mahjongPaymentRequired("guest")).toBe(true);
    expect(mahjongPaymentRequired("staff")).toBe(false);
    // 未設定は会員扱い＝要支払い
    expect(mahjongPaymentRequired(undefined)).toBe(true);
  });

  test("ROLE_LABELS: 表示ラベル", () => {
    expect(ROLE_LABELS.member).toBe("会員");
    expect(ROLE_LABELS.guest).toBe("ゲスト");
    expect(ROLE_LABELS.staff).toBe("エイト社員");
  });
});
