import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { signSession, setSessionCookie } from "@/lib/session";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import crypto from "crypto";

export const dynamic = "force-dynamic";

// ─── パスワードハッシュ ───────────────────────────────────────────────────────

const ITERATIONS_TARGET = 100_000;

function hashPassword(
  password: string,
  salt: string,
  iterations = ITERATIONS_TARGET
): string {
  return crypto
    .pbkdf2Sync(password, salt, iterations, 64, "sha256")
    .toString("hex");
}

/**
 * POST /api/auth/login
 * メールアドレスとパスワードで認証し、セッションCookieを発行する。
 * Body: { email, password, lineUserId? }
 */
export async function POST(req: NextRequest) {
  // ─── レートリミット（1IP あたり 10回/5分） ────────────────────────────
  const ip = getClientIp(req);
  if (!checkRateLimit(`login:${ip}`, 10, 5 * 60 * 1000)) {
    return NextResponse.json(
      { error: "しばらくしてからもう一度お試しください" },
      { status: 429 }
    );
  }

  try {
    const body = await req.json();
    const { email, password, lineUserId } = body as {
      email: string;
      password: string;
      lineUserId?: string | null;
    };

    if (!email || !password) {
      return NextResponse.json(
        { error: "メールアドレスとパスワードを入力してください" },
        { status: 400 }
      );
    }

    const db = getDb();
    const snap = await db
      .collection("authorizedUsers")
      .where("email", "==", email.toLowerCase().trim())
      .limit(1)
      .get();

    if (snap.empty) {
      return NextResponse.json(
        { error: "メールアドレスまたはパスワードが正しくありません" },
        { status: 401 }
      );
    }

    const doc = snap.docs[0];
    const userData = doc.data();

    if (!userData.active) {
      return NextResponse.json(
        { error: "このアカウントは無効です。管理者にお問い合わせください" },
        { status: 403 }
      );
    }

    // 旧レコードは iterations フィールドなし（= 1000回）
    const storedIterations: number = userData.iterations ?? 1_000;
    const hash = hashPassword(password, userData.salt, storedIterations);

    if (hash !== userData.passwordHash) {
      return NextResponse.json(
        { error: "メールアドレスまたはパスワードが正しくありません" },
        { status: 401 }
      );
    }

    // ─── パスワードハッシュのマイグレーション ──────────────────────────────
    // 旧レコード（iterations < 100000）はログイン成功時に自動アップグレード
    const updates: Record<string, unknown> = {
      lastLoginAt: new Date().toISOString(),
    };

    if (storedIterations < ITERATIONS_TARGET) {
      const newSalt = crypto.randomBytes(16).toString("hex");
      updates.salt = newSalt;
      updates.passwordHash = hashPassword(password, newSalt, ITERATIONS_TARGET);
      updates.iterations = ITERATIONS_TARGET;
    }

    if (lineUserId) {
      updates.lineUserId = lineUserId;
    }

    await doc.ref.update(updates);

    // users コレクションにも同期（予約表示名に使用）
    if (lineUserId) {
      const userRef = db.collection("users").doc(lineUserId);
      await userRef.set(
        {
          displayName: userData.displayName,
          tenantName: userData.tenantName ?? "",
          lineUserId,
          email: userData.email,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    }

    // ─── JWT セッション Cookie 発行 ────────────────────────────────────────
    const sessionUserId = lineUserId ?? `email:${userData.email}`;
    const token = await signSession(sessionUserId);

    const res = NextResponse.json({
      success: true,
      displayName: userData.displayName,
    });
    setSessionCookie(res, token);
    return res;
  } catch (error) {
    console.error("[auth/login] error:", error);
    return NextResponse.json(
      { error: "ログインに失敗しました。しばらくしてからお試しください" },
      { status: 500 }
    );
  }
}
