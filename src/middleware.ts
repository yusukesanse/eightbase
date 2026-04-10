import { NextRequest, NextResponse } from "next/server";

/**
 * ドメインベースのルーティング Middleware
 *
 * 環境変数 CUSTOMER_DOMAIN / ADMIN_DOMAIN でドメインを設定。
 * - 顧客ドメイン → /admin/* へのアクセスをブロック
 * - 管理ドメイン → /admin/* のみ許可
 * - *.vercel.app / localhost → 開発環境は制限なし
 */

const CUSTOMER_DOMAIN = process.env.CUSTOMER_DOMAIN || "";
const ADMIN_DOMAIN = process.env.ADMIN_DOMAIN || "";

export function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const pathname = req.nextUrl.pathname;

  // 静的ファイル・API・_next は常に通す
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // 開発環境・Vercelプレビューは制限なし
  if (
    host.includes("localhost") ||
    host.includes("vercel.app")
  ) {
    return NextResponse.next();
  }

  // ドメインが未設定の場合は制限なし
  if (!CUSTOMER_DOMAIN && !ADMIN_DOMAIN) {
    return NextResponse.next();
  }

  // 管理者ドメイン: /admin/* 以外へのアクセスは /admin にリダイレクト
  if (ADMIN_DOMAIN && host === ADMIN_DOMAIN) {
    if (!pathname.startsWith("/admin")) {
      return NextResponse.redirect(new URL("/admin", req.url));
    }
    return NextResponse.next();
  }

  // 顧客ドメイン: /admin/* へのアクセスは 404
  if (CUSTOMER_DOMAIN && host === CUSTOMER_DOMAIN) {
    if (pathname.startsWith("/admin")) {
      return NextResponse.rewrite(new URL("/not-found", req.url));
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
