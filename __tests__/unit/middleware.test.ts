/**
 * 単体テスト: src/middleware.ts ドメインベースのルーティング
 *
 * 重要ポイント: ドメイン一致判定を vercel.app 例外より先に評価する。
 * これにより demo で ADMIN_DOMAIN/CUSTOMER_DOMAIN に vercel.app ドメインを
 * 割り当てても admin/顧客の分離が効く。
 *
 * CUSTOMER_DOMAIN / ADMIN_DOMAIN は middleware のモジュール読み込み時に
 * 固定されるため、各設定ごとに resetModules して読み直す。
 */
import type { NextRequest, NextResponse } from "next/server";

type Middleware = (req: NextRequest) => NextResponse;

function loadMiddleware(env: { ADMIN_DOMAIN?: string; CUSTOMER_DOMAIN?: string }): Middleware {
  jest.resetModules();
  process.env.ADMIN_DOMAIN = env.ADMIN_DOMAIN ?? "";
  process.env.CUSTOMER_DOMAIN = env.CUSTOMER_DOMAIN ?? "";
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("@/middleware").middleware as Middleware;
}

function req(host: string, path: string, method = "GET"): NextRequest {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { NextRequest } = require("next/server");
  return new NextRequest(`https://${host}${path}`, { method, headers: { host } });
}

const isNext = (res: NextResponse) => res.headers.get("x-middleware-next") === "1";
const rewriteTo = (res: NextResponse) => res.headers.get("x-middleware-rewrite");
const redirectTo = (res: NextResponse) =>
  res.headers.get("location") ?? res.headers.get("Location");

const ADMIN = "admin.demo.example.net";
const CUSTOMER = "portal.demo.example.net";

describe("middleware — カスタムドメインでの admin/顧客 分離", () => {
  test("管理ドメイン + /admin 以外 → /admin へリダイレクト", () => {
    const mw = loadMiddleware({ ADMIN_DOMAIN: ADMIN, CUSTOMER_DOMAIN: CUSTOMER });
    const res = mw(req(ADMIN, "/reservation"));
    expect(redirectTo(res)).toContain("/admin");
  });

  test("管理ドメイン + /admin/* → 通す", () => {
    const mw = loadMiddleware({ ADMIN_DOMAIN: ADMIN, CUSTOMER_DOMAIN: CUSTOMER });
    expect(isNext(mw(req(ADMIN, "/admin/users")))).toBe(true);
  });

  test("顧客ドメイン + /admin → /not-found に rewrite（404）", () => {
    const mw = loadMiddleware({ ADMIN_DOMAIN: ADMIN, CUSTOMER_DOMAIN: CUSTOMER });
    expect(rewriteTo(mw(req(CUSTOMER, "/admin")))).toContain("/not-found");
  });

  test("顧客ドメイン + 顧客画面 → 通す", () => {
    const mw = loadMiddleware({ ADMIN_DOMAIN: ADMIN, CUSTOMER_DOMAIN: CUSTOMER });
    expect(isNext(mw(req(CUSTOMER, "/reservation")))).toBe(true);
  });
});

describe("middleware — vercel.app ドメインでも分離が効く（demo 低コスト構成）", () => {
  const ADMIN_VERCEL = "eightbase-demo-admin.vercel.app";
  const CUSTOMER_VERCEL = "eightbase-demo.vercel.app";

  test("vercel.app の管理ドメイン + / → /admin へリダイレクト（例外より先に一致）", () => {
    const mw = loadMiddleware({ ADMIN_DOMAIN: ADMIN_VERCEL, CUSTOMER_DOMAIN: CUSTOMER_VERCEL });
    expect(redirectTo(mw(req(ADMIN_VERCEL, "/")))).toContain("/admin");
  });

  test("vercel.app の顧客ドメイン + /admin → 404 rewrite", () => {
    const mw = loadMiddleware({ ADMIN_DOMAIN: ADMIN_VERCEL, CUSTOMER_DOMAIN: CUSTOMER_VERCEL });
    expect(rewriteTo(mw(req(CUSTOMER_VERCEL, "/admin")))).toContain("/not-found");
  });
});

describe("middleware — 従来挙動の維持", () => {
  test("どのドメインにも一致しないランダムな *.vercel.app（プレビュー）は無制限", () => {
    const mw = loadMiddleware({ ADMIN_DOMAIN: ADMIN, CUSTOMER_DOMAIN: CUSTOMER });
    expect(isNext(mw(req("eightbase-demo-git-feature.vercel.app", "/admin")))).toBe(true);
  });

  test("localhost は無制限", () => {
    const mw = loadMiddleware({ ADMIN_DOMAIN: ADMIN, CUSTOMER_DOMAIN: CUSTOMER });
    expect(isNext(mw(req("localhost:3000", "/admin")))).toBe(true);
  });

  test("ドメイン未設定なら無制限", () => {
    const mw = loadMiddleware({});
    expect(isNext(mw(req("eightbase-demo.vercel.app", "/admin")))).toBe(true);
  });

  test("/api/* は常に通す（顧客ドメインでもブロックしない）", () => {
    const mw = loadMiddleware({ ADMIN_DOMAIN: ADMIN, CUSTOMER_DOMAIN: CUSTOMER });
    expect(isNext(mw(req(CUSTOMER, "/api/admin/users")))).toBe(true);
  });
});
