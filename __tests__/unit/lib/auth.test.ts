/**
 * 単体テスト: src/lib/auth.ts の認可ヘルパー
 * requireGameUser（member/guest 可）/ requireMember（guest 除外）/
 * requireMemberProfileComplete（guest 除外＋profileComplete）の role 判定を検証。
 */
import type { NextRequest } from "next/server";

// 各テストで差し替える状態
let mockSessionUserId: string | null = null;
let mockUserDoc: Record<string, unknown> | null = null; // authorizedUsers の active レコード（null=未登録/active外）

jest.mock("@/lib/session", () => ({
  getSessionUserId: async () => mockSessionUserId,
}));
jest.mock("@/lib/preview", () => ({
  isPreviewMode: async () => false,
  PREVIEW_USER_ID: "preview-user",
}));
jest.mock("@/lib/env", () => ({
  isDevLoginEnabled: () => false,
}));
jest.mock("@/lib/firebaseAdmin", () => ({
  getDb: () => ({
    collection: () => ({
      where: () => ({
        where: () => ({
          limit: () => ({
            get: async () => ({
              empty: mockUserDoc === null,
              docs: mockUserDoc === null ? [] : [{ data: () => mockUserDoc }],
            }),
          }),
        }),
      }),
    }),
  }),
}));

import {
  requireGameUser,
  requireMember,
  requireMemberProfileComplete,
} from "@/lib/auth";

const req = { method: "GET" } as unknown as NextRequest;

beforeEach(() => {
  mockSessionUserId = "U_user";
  mockUserDoc = null;
});

describe("requireGameUser — member/guest どちらも許可", () => {
  test("member を許可", async () => {
    mockUserDoc = { role: "member", active: true, profileComplete: true };
    expect(await requireGameUser(req)).toBe("U_user");
  });

  test("guest を許可", async () => {
    mockUserDoc = { role: "guest", active: true, profileComplete: false };
    expect(await requireGameUser(req)).toBe("U_user");
  });

  test("role 未設定(旧会員)も許可", async () => {
    mockUserDoc = { active: true };
    expect(await requireGameUser(req)).toBe("U_user");
  });

  test("セッション無しは拒否", async () => {
    mockSessionUserId = null;
    mockUserDoc = { role: "guest", active: true };
    expect(await requireGameUser(req)).toBeNull();
  });

  test("未登録(active外)は拒否", async () => {
    mockUserDoc = null;
    expect(await requireGameUser(req)).toBeNull();
  });
});

describe("requireMember — guest を除外", () => {
  test("member を許可", async () => {
    mockUserDoc = { role: "member", active: true };
    expect(await requireMember(req)).toBe("U_user");
  });

  test("role 未設定(旧会員)は member 扱いで許可", async () => {
    mockUserDoc = { active: true };
    expect(await requireMember(req)).toBe("U_user");
  });

  test("guest は拒否", async () => {
    mockUserDoc = { role: "guest", active: true };
    expect(await requireMember(req)).toBeNull();
  });

  test("未登録は拒否", async () => {
    mockUserDoc = null;
    expect(await requireMember(req)).toBeNull();
  });
});

describe("requireMemberProfileComplete — guest除外＋profileComplete", () => {
  test("member かつ profileComplete を許可", async () => {
    mockUserDoc = { role: "member", active: true, profileComplete: true };
    expect(await requireMemberProfileComplete(req)).toBe("U_user");
  });

  test("member だが profileComplete=false は拒否", async () => {
    mockUserDoc = { role: "member", active: true, profileComplete: false };
    expect(await requireMemberProfileComplete(req)).toBeNull();
  });

  test("guest は profileComplete でも拒否", async () => {
    mockUserDoc = { role: "guest", active: true, profileComplete: true };
    expect(await requireMemberProfileComplete(req)).toBeNull();
  });

  test("未登録は拒否", async () => {
    mockUserDoc = null;
    expect(await requireMemberProfileComplete(req)).toBeNull();
  });
});
