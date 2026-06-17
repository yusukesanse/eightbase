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

/** プレビューモードでアクセスを禁止するパス（セキュリティ上の理由） */
const PREVIEW_BLOCKED_PREFIXES = [
  "/admin/users",
  "/admin/calendars",
  "/admin/admin-users",
  "/api/admin/users",
  "/api/admin/admin-users",
];

export function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const pathname = req.nextUrl.pathname;

  // プレビューモード: 書き込み API をブロック
  if (
    pathname.startsWith("/api/") &&
    !pathname.startsWith("/api/preview/activate") &&
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.cookies.has("__preview")
  ) {
    return NextResponse.json(
      { error: "Preview mode is read-only" },
      { status: 403 }
    );
  }

  // プレビューモード: セキュリティ上ブロックするページ/API
  if (req.cookies.has("__preview") && PREVIEW_BLOCKED_PREFIXES.some((p) => pathname.startsWith(p))) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "この情報はプレビューモードでは閲覧できません" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/preview", req.url));
  }

  // 静的ファイル・API・_next・プレビュー は常に通す
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/preview") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // プレビューモード: ドメイン制限をスキップ（全画面閲覧可能）
  if (req.cookies.has("__preview")) {
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
