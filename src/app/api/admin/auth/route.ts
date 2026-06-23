import { NextRequest, NextResponse } from "next/server";
import {
  signAdminToken,
  verifyAdminToken,
  setAdminCookie,
  clearAdminCookie,
} from "@/lib/adminAuth";
import { getDb } from "@/lib/firebaseAdmin";
import { isPreviewMode, PREVIEW_ADMIN_EMAIL } from "@/lib/preview";
import { isProduction } from "@/lib/env";
import { timingSafeEqual } from "crypto";

export const dynamic = "force-dynamic";

/** パスワードログイン時の管理者アイデンティティ（非本番専用） */
const SIMPLE_ADMIN_EMAIL = "staging-admin@eightbase.local";

/** 環境変数のスーパー管理者リスト（常にアクセス可能） */
const SUPER_ADMIN_EMAILS: string[] = (() => {
  const envEmails = process.env.ADMIN_EMAILS;
  if (envEmails) return envEmails.split(",").map((e) => e.trim().toLowerCase());
  return [];
})();

/**
 * メールアドレスが管理者として許可されているか検証
 * 1. ADMIN_EMAILS 環境変数（スーパー管理者）
 * 2. Firestore adminUsers コレクション
 */
async function isAuthorizedAdmin(email: string): Promise<boolean> {
  // スーパー管理者チェック
  if (SUPER_ADMIN_EMAILS.includes(email)) return true;

  // Firestore チェック
  try {
    const db = getDb();
    const snapshot = await db
      .collection("adminUsers")
      .where("email", "==", email)
      .limit(1)
      .get();
    return !snapshot.empty;
  } catch (error) {
    console.error("[admin/auth] Firestore check failed:", error);
    return false;
  }
}

/* ───────── ログイン履歴記録 ───────── */

type LoginAction = "login_success" | "login_denied" | "login_failed" | "logout";

async function recordLoginLog(
  action: LoginAction,
  details: {
    email?: string;
    name?: string;
    reason?: string;
    ip?: string;
    userAgent?: string;
  }
) {
  try {
    const db = getDb();
    await db.collection("adminLoginLogs").add({
      action,
      email: details.email || "",
      name: details.name || "",
      reason: details.reason || "",
      ip: details.ip || "",
      userAgent: details.userAgent || "",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    // ログ記録の失敗でログイン処理を止めない
    console.error("[admin/auth] Failed to record login log:", err);
  }
}

/** リクエストからIP・UserAgentを取得 */
function getRequestMeta(req: NextRequest) {
  return {
    ip:
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown",
    userAgent: req.headers.get("user-agent") || "unknown",
  };
}

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID ?? "";

/**
 * パスワードログイン（**非本番のみ**）
 * staging / development では Google OAuth の代わりに `ADMIN_SIMPLE_PASSWORD` 一本でログイン可。
 * 本番では常に無効（`isProduction()` で経路を閉じ、prebuild でもフラグ混入を弾く）。
 */
async function handlePasswordLogin(
  password: string,
  meta: { ip: string; userAgent: string }
) {
  const configured = process.env.ADMIN_SIMPLE_PASSWORD ?? "";

  // 本番では無効。非本番でも未設定なら無効。
  if (isProduction() || !configured) {
    await recordLoginLog("login_denied", {
      reason: "パスワードログインは無効な環境",
      ...meta,
    });
    return NextResponse.json(
      { error: "この環境ではパスワードログインは利用できません" },
      { status: 403 }
    );
  }

  const a = Buffer.from(password);
  const b = Buffer.from(configured);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  if (!ok) {
    await recordLoginLog("login_failed", { reason: "パスワード不一致", ...meta });
    return NextResponse.json({ error: "パスワードが違います" }, { status: 401 });
  }

  await recordLoginLog("login_success", {
    email: SIMPLE_ADMIN_EMAIL,
    name: "Staging Admin",
    ...meta,
  });
  const jwt = await signAdminToken(SIMPLE_ADMIN_EMAIL);
  const res = NextResponse.json({
    success: true,
    email: SIMPLE_ADMIN_EMAIL,
    name: "Staging Admin",
  });
  setAdminCookie(res, jwt);
  return res;
}

/**
 * POST /api/admin/auth
 * - Google OAuth ログイン: `{ idToken }` を検証し、許可メールならセッション Cookie 発行（全環境）
 * - パスワードログイン: `{ password }` を `ADMIN_SIMPLE_PASSWORD` と照合（**非本番のみ**）
 */
export async function POST(req: NextRequest) {
  const meta = getRequestMeta(req);

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));

    // ── パスワードログイン経路（非本番のみ） ──
    if (typeof body.password === "string") {
      return await handlePasswordLogin(body.password, meta);
    }

    const idToken = body.idToken;

    if (!idToken || typeof idToken !== "string") {
      return NextResponse.json(
        { error: "IDトークンがありません" },
        { status: 400 }
      );
    }

    if (!GOOGLE_CLIENT_ID) {
      console.error("[admin/auth] NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID is not set");
      return NextResponse.json(
        { error: "サーバー設定エラー" },
        { status: 500 }
      );
    }

    // ── 1. Google ID トークンを検証 ──
    const { OAuth2Client } = await import("google-auth-library");
    const client = new OAuth2Client(GOOGLE_CLIENT_ID);

    let payload;
    try {
      const ticket = await client.verifyIdToken({
        idToken,
        audience: GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (err) {
      console.error("[admin/auth] Google token verification failed:", err);
      await recordLoginLog("login_failed", {
        reason: "Googleトークン検証失敗",
        ...meta,
      });
      return NextResponse.json(
        { error: "Googleトークンの検証に失敗しました" },
        { status: 401 }
      );
    }

    if (!payload || !payload.email) {
      await recordLoginLog("login_failed", {
        reason: "メールアドレス取得不可",
        ...meta,
      });
      return NextResponse.json(
        { error: "メールアドレスを取得できませんでした" },
        { status: 401 }
      );
    }

    if (!payload.email_verified) {
      await recordLoginLog("login_denied", {
        email: payload.email,
        name: payload.name,
        reason: "メール未検証",
        ...meta,
      });
      return NextResponse.json(
        { error: "メールアドレスが未検証です" },
        { status: 401 }
      );
    }

    const email = payload.email.toLowerCase();

    // ── 2. 管理者メールアドレスの検証（環境変数 + Firestore） ──
    const authorized = await isAuthorizedAdmin(email);
    if (!authorized) {
      console.warn(`[admin/auth] Unauthorized admin login attempt: ${email}`);
      await recordLoginLog("login_denied", {
        email,
        name: payload.name,
        reason: "管理者権限なし",
        ...meta,
      });
      return NextResponse.json(
        { error: "このアカウントには管理者権限がありません" },
        { status: 403 }
      );
    }

    console.log(`[admin/auth] Admin login: ${email} (${payload.name})`);

    // ── 3. ログイン成功を記録 ──
    await recordLoginLog("login_success", {
      email,
      name: payload.name,
      ...meta,
    });

    // ── 4. 管理者セッション Cookie を発行 ──
    const jwt = await signAdminToken(email);
    const res = NextResponse.json({
      success: true,
      email,
      name: payload.name,
    });
    setAdminCookie(res, jwt);
    return res;
  } catch (error) {
    console.error("[admin/auth] error:", error);
    await recordLoginLog("login_failed", {
      reason: "サーバーエラー",
      ...meta,
    });
    return NextResponse.json(
      { error: "ログインに失敗しました" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/auth
 * 管理者ログアウト: httpOnly Cookie をクリア
 */
export async function DELETE(req: NextRequest) {
  const meta = getRequestMeta(req);

  // ログアウトするユーザーのメールを取得
  const cookie = req.cookies.get("__admin_session")?.value;
  let email = "";
  if (cookie) {
    email = (await verifyAdminToken(cookie)) || "";
  }

  if (email) {
    await recordLoginLog("logout", { email, ...meta });
  }

  const res = NextResponse.json({ success: true });
  clearAdminCookie(res);
  return res;
}

/**
 * GET /api/admin/auth
 * セッション確認: Cookie の JWT が有効かチェック
 */
export async function GET(req: NextRequest) {
  // プレビューモード: 認証OKを返す
  if (await isPreviewMode(req)) {
    return NextResponse.json({ authenticated: true, email: PREVIEW_ADMIN_EMAIL, preview: true, readOnly: true });
  }

  const cookie = req.cookies.get("__admin_session")?.value;

  if (!cookie) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const result = await verifyAdminToken(cookie);
  if (!result) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({ authenticated: true, email: result });
}
