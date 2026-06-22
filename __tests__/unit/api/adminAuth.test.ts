/**
 * 結合テスト: /api/admin/auth
 * 管理者認証API（Google OAuth + httpOnly Cookie セッション）のテスト
 *
 * 認証方式: POST で Google ID トークンを検証 →
 * 許可リスト(ADMIN_EMAILS / Firestore adminUsers)に含まれれば __admin_session Cookie を発行。
 * GET は Cookie の JWT を検証。DELETE で Cookie をクリア。
 */

// ── Google OAuth クライアントをモック ──
const mockVerifyIdToken = jest.fn();
jest.mock("google-auth-library", () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));

// ── Firestore をモック（ログ記録 + 管理者照合） ──
const mockAdd = jest.fn().mockResolvedValue(undefined);
const mockGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });
jest.mock("@/lib/firebaseAdmin", () => ({
  getDb: () => ({
    collection: () => ({
      add: mockAdd,
      where: () => ({ limit: () => ({ get: mockGet }) }),
    }),
  }),
}));

import { POST, DELETE, GET } from "@/app/api/admin/auth/route";
import { NextRequest } from "next/server";
import { signAdminToken } from "@/lib/adminAuth";

const AUTHORIZED_EMAIL = "admin@example.com"; // jest.setup.ts の ADMIN_EMAILS と一致

function createRequest(
  method: string,
  body?: object,
  headers?: Record<string, string>,
  cookies?: Record<string, string>
): NextRequest {
  const url = "http://localhost:3000/api/admin/auth";
  const init: { method: string; headers: Record<string, string>; body?: string } = {
    method,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  };
  if (body) {
    init.body = JSON.stringify(body);
  }
  const req = new NextRequest(url, init);
  if (cookies) {
    for (const [key, value] of Object.entries(cookies)) {
      req.cookies.set(key, value);
    }
  }
  return req;
}

/** verifyIdToken が指定 payload を返すよう設定 */
function mockGooglePayload(payload: Record<string, unknown> | null) {
  mockVerifyIdToken.mockResolvedValueOnce({ getPayload: () => payload });
}

describe("API /api/admin/auth — 管理者認証", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue({ empty: true, docs: [] });
  });

  // IT-AAUTH-001: 正しい Google トークン + 許可メールでログイン成功
  test("POST: 認可済みメールでログイン成功 → httpOnly Cookie設定", async () => {
    mockGooglePayload({ email: AUTHORIZED_EMAIL, email_verified: true, name: "管理者" });

    const req = createRequest("POST", { idToken: "valid-google-id-token" });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.email).toBe(AUTHORIZED_EMAIL);

    const setCookieHeader = res.headers.get("set-cookie");
    expect(setCookieHeader).toBeTruthy();
    expect(setCookieHeader).toContain("__admin_session");
    expect(setCookieHeader).toContain("HttpOnly");
  });

  // IT-AAUTH-002: Google トークン検証失敗で401エラー
  test("POST: 無効なGoogleトークンで401エラー", async () => {
    mockVerifyIdToken.mockRejectedValueOnce(new Error("invalid token"));

    const req = createRequest("POST", { idToken: "wrong-token" });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBeTruthy();
  });

  // IT-AAUTH-003: idTokenなしで400エラー
  test("POST: idTokenなしで400エラー", async () => {
    const req = createRequest("POST", {});
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  // IT-AAUTH-003b: 許可されていないメールで403エラー
  test("POST: 許可リスト外のメールで403エラー", async () => {
    mockGooglePayload({ email: "nobody@example.com", email_verified: true, name: "他人" });

    const req = createRequest("POST", { idToken: "valid-google-id-token" });
    const res = await POST(req);

    expect(res.status).toBe(403);
  });

  // IT-AAUTH-004: ログアウト
  test("DELETE: ログアウトでCookieクリア", async () => {
    const res = await DELETE(createRequest("DELETE"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);

    const setCookieHeader = res.headers.get("set-cookie");
    expect(setCookieHeader).toContain("__admin_session=;");
  });

  // IT-AAUTH-005: 有効なセッションCookieで認証チェック成功
  test("GET: 有効なセッションCookieで認証成功", async () => {
    const token = await signAdminToken(AUTHORIZED_EMAIL);
    const req = createRequest("GET", undefined, undefined, {
      __admin_session: token,
    });
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.authenticated).toBe(true);
    expect(json.email).toBe(AUTHORIZED_EMAIL);
  });

  // IT-AAUTH-006: 認証なしでGET
  test("GET: 認証なしで401エラー", async () => {
    const req = createRequest("GET");
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.authenticated).toBe(false);
  });

  // IT-AAUTH-007: 不正なセッションCookie
  test("GET: 不正なセッションCookieで401エラー", async () => {
    const req = createRequest("GET", undefined, undefined, {
      __admin_session: "invalid-jwt-value",
    });
    const res = await GET(req);

    expect(res.status).toBe(401);
  });
});
