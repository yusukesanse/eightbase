import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { signAdminToken, setAdminCookie } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

const MAX_ATTEMPTS = 5;

/**
 * POST /api/admin/auth/verify-code
 * 6桁コードを検証し、正しければセッションCookieを発行
 *
 * Body: { email: string, code: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, code } = body;

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "メールアドレスが必要です" }, { status: 400 });
    }
    if (!code || typeof code !== "string" || code.length !== 6) {
      return NextResponse.json({ error: "6桁の認証コードを入力してください" }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const db = getDb();

    // 最新の未使用コードを取得
    const codesSnap = await db
      .collection("adminAuthCodes")
      .where("email", "==", normalizedEmail)
      .where("used", "==", false)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    if (codesSnap.empty) {
      return NextResponse.json(
        { error: "認証コードが見つかりません。再度コードを送信してください" },
        { status: 400 }
      );
    }

    const codeDoc = codesSnap.docs[0];
    const codeData = codeDoc.data();

    // 有効期限チェック
    if (new Date(codeData.expiresAt) < new Date()) {
      await codeDoc.ref.update({ used: true });
      return NextResponse.json(
        { error: "認証コードの有効期限が切れています。再度コードを送信してください" },
        { status: 400 }
      );
    }

    // 試行回数チェック
    if ((codeData.attempts || 0) >= MAX_ATTEMPTS) {
      await codeDoc.ref.update({ used: true });
      return NextResponse.json(
        { error: "入力回数の上限に達しました。再度コードを送信してください" },
        { status: 429 }
      );
    }

    // コード照合
    if (codeData.code !== code) {
      await codeDoc.ref.update({ attempts: (codeData.attempts || 0) + 1 });
      const remaining = MAX_ATTEMPTS - (codeData.attempts || 0) - 1;
      return NextResponse.json(
        { error: `認証コードが一致しません（残り${remaining}回）` },
        { status: 400 }
      );
    }

    // コードを使用済みに
    await codeDoc.ref.update({ used: true });

    // ── ログイン記録 ──
    const meta = {
      ip:
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        "unknown",
      userAgent: req.headers.get("user-agent") || "unknown",
    };

    await db.collection("adminLoginLogs").add({
      action: "login_success",
      email: normalizedEmail,
      name: "",
      reason: "メール認証コード",
      ip: meta.ip,
      userAgent: meta.userAgent,
      timestamp: new Date().toISOString(),
    });

    console.log(`[verify-code] Email login success: ${normalizedEmail}`);

    // ── セッションCookie発行 ──
    const jwt = await signAdminToken(normalizedEmail);
    const res = NextResponse.json({
      success: true,
      email: normalizedEmail,
    });
    setAdminCookie(res, jwt);
    return res;
  } catch (error) {
    console.error("[verify-code] error:", error);
    return NextResponse.json({ error: "認証に失敗しました" }, { status: 500 });
  }
}
