import { NextRequest, NextResponse } from "next/server";

/**
 * ドメインベースのルーティング Middleware
 *
 * - portal.eightbase.net   → 顧客向けアプリ（/admin/* へのアクセスをブロック）
 * - admin.eightbase.net    → 管理者向けアプリ（/admin/* のみ許可）
 * - *.vercel.app / localhost → 開発環境は制限なし
 */

const CUSTOMER_DOMAIN = "portal.eightbase.net";
const ADMIN_DOMAIN = "admin.eightbase.net";

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

  // 管理者ドメイン: /admin/* 以外へのアクセスは /admin にリダイレクト
  if (host === ADMIN_DOMAIN) {
    if (!pathname.startsWith("/admin")) {
      return NextResponse.redirect(new URL("/admin", req.url));
    }
    return NextResponse.next();
  }

  // 顧客ドメイン: /admin/* へのアクセスは 404
  if (host === CUSTOMER_DOMAIN) {
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
