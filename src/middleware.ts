import { NextRequest, NextResponse } from "next/server";

/**
 * ドメインベースのルーティング Middleware
 *
 * 環境変数 CUSTOMER_DOMAIN / ADMIN_DOMAIN でドメインを設定。
 * - 顧客ドメイン → /admin/* へのアクセスをブロック
 * - 管理ドメイン → /admin/* のみ許可
 * - 上記いずれにも一致しない *.vercel.app / localhost → 開発環境として制限なし
 *
 * 評価順は「ドメイン一致 → その後に vercel.app/localhost 例外」。
 * これにより demo で ADMIN_DOMAIN/CUSTOMER_DOMAIN に vercel.app ドメイン
 * （例: eightbase-demo-admin.vercel.app）を割り当てても分離が効く。
 * 一致しないランダムな *.vercel.app（プレビュー等）は従来どおり無制限。
 */

const CUSTOMER_DOMAIN = process.env.CUSTOMER_DOMAIN || "";
const ADMIN_DOMAIN = process.env.ADMIN_DOMAIN || "";

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

  // ── ドメインベースのルーティング（設定済み & ホスト一致を最優先で評価） ──
  // vercel.app / localhost の例外より先に判定する。これにより demo で
  // ADMIN_DOMAIN/CUSTOMER_DOMAIN に vercel.app ドメインを割り当てても分離が効く。

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

  // ── 上記いずれのドメインにも一致しないホスト ──
  // 開発環境・Vercelプレビュー（ランダムな *.vercel.app）は制限なし
  if (
    host.includes("localhost") ||
    host.includes("vercel.app")
  ) {
    return NextResponse.next();
  }

  // ドメインが未設定の場合も制限なし
  if (!CUSTOMER_DOMAIN && !ADMIN_DOMAIN) {
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
