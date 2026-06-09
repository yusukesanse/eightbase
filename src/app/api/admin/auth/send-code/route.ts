import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";

export const dynamic = "force-dynamic";

/** 環境変数のスーパー管理者リスト */
const SUPER_ADMIN_EMAILS: string[] = (() => {
  const envEmails = process.env.ADMIN_EMAILS;
  if (envEmails) return envEmails.split(",").map((e) => e.trim().toLowerCase());
  return [];
})();

/**
 * POST /api/admin/auth/send-code
 * メール認証: reCAPTCHA検証 → 管理者チェック → 6桁コード生成 → Resend送信
 *
 * Body: { email: string, recaptchaToken: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, recaptchaToken } = body;

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "メールアドレスを入力してください" }, { status: 400 });
    }
    if (!recaptchaToken || typeof recaptchaToken !== "string") {
      return NextResponse.json({ error: "reCAPTCHAを完了してください" }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // ── 1. reCAPTCHA v2 サーバー検証 ──
    const recaptchaSecret = process.env.RECAPTCHA_SECRET_KEY;
    if (!recaptchaSecret) {
      console.error("[send-code] RECAPTCHA_SECRET_KEY is not set");
      return NextResponse.json({ error: "サーバー設定エラー" }, { status: 500 });
    }

    const recaptchaRes = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `secret=${recaptchaSecret}&response=${recaptchaToken}`,
    });
    const recaptchaData = await recaptchaRes.json();

    if (!recaptchaData.success) {
      console.warn("[send-code] reCAPTCHA verification failed:", recaptchaData);
      return NextResponse.json({ error: "reCAPTCHA検証に失敗しました" }, { status: 400 });
    }

    // ── 2. 管理者メールチェック ──
    const isAuthorized = await checkAdminEmail(normalizedEmail);
    if (!isAuthorized) {
      // セキュリティ: 登録されていなくても「送信しました」と返す
      // ただし実際には送信しない
      console.warn(`[send-code] Unauthorized email attempt: ${normalizedEmail}`);
      return NextResponse.json({ success: true });
    }

    // ── 3. レート制限チェック（同一メール5分以内の再送信を制限） ──
    const db = getDb();
    const recentCodes = await db
      .collection("adminAuthCodes")
      .where("email", "==", normalizedEmail)
      .where("createdAt", ">", new Date(Date.now() - 60 * 1000).toISOString()) // 1分以内
      .get();

    if (!recentCodes.empty) {
      return NextResponse.json(
        { error: "認証コードは1分ごとに送信できます。しばらくお待ちください" },
        { status: 429 }
      );
    }

    // ── 4. 6桁コード生成 ──
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10分有効

    // Firestore に保存
    await db.collection("adminAuthCodes").add({
      email: normalizedEmail,
      code,
      expiresAt,
      used: false,
      attempts: 0,
      createdAt: new Date().toISOString(),
    });

    // 古いコードを無効化（同じメールの未使用コード）
    const oldCodes = await db
      .collection("adminAuthCodes")
      .where("email", "==", normalizedEmail)
      .where("used", "==", false)
      .get();

    const batch = db.batch();
    let invalidated = 0;
    oldCodes.docs.forEach((doc) => {
      const data = doc.data();
      if (data.code !== code) {
        batch.update(doc.ref, { used: true });
        invalidated++;
      }
    });
    if (invalidated > 0) await batch.commit();

    // ── 5. Resend でメール送信 ──
    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

    if (!resendApiKey) {
      console.error("[send-code] RESEND_API_KEY is not set");
      return NextResponse.json({ error: "メール送信設定エラー" }, { status: 500 });
    }

    const { Resend } = await import("resend");
    const resend = new Resend(resendApiKey);

    await resend.emails.send({
      to: normalizedEmail,
      from: `EIGHT BASE UNGA <${fromEmail}>`,
      subject: "【EIGHT BASE UNGA】管理画面ログイン認証コード",
      text: `管理画面ログインの認証コードです。\n\n認証コード: ${code}\n\nこのコードは10分間有効です。\n心当たりのない場合はこのメールを無視してください。`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
          <div style="background: linear-gradient(135deg, #A5C1C8 0%, #7BA8B0 100%); border-radius: 12px; padding: 24px; margin-bottom: 24px; text-align: center;">
            <h1 style="color: white; font-size: 18px; margin: 0;">EIGHT BASE UNGA</h1>
            <p style="color: rgba(255,255,255,0.8); font-size: 13px; margin: 4px 0 0;">管理画面ログイン認証</p>
          </div>
          <p style="color: #231714; font-size: 14px; line-height: 1.6;">管理画面ログインの認証コードです。</p>
          <div style="background: #f8f9fa; border: 2px solid #e9ecef; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
            <p style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #231714; margin: 0;">${code}</p>
          </div>
          <p style="color: #666; font-size: 12px; line-height: 1.6;">
            このコードは <strong>10分間</strong> 有効です。<br/>
            心当たりのない場合はこのメールを無視してください。
          </p>
        </div>
      `,
    });

    console.log(`[send-code] Code sent to ${normalizedEmail}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[send-code] error:", error);
    return NextResponse.json({ error: "認証コードの送信に失敗しました" }, { status: 500 });
  }
}

/** メールが管理者として登録されているかチェック */
async function checkAdminEmail(email: string): Promise<boolean> {
  if (SUPER_ADMIN_EMAILS.includes(email)) return true;
  try {
    const db = getDb();
    const snap = await db
      .collection("adminUsers")
      .where("email", "==", email)
      .limit(1)
      .get();
    return !snap.empty;
  } catch {
    return false;
  }
}
