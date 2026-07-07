import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { verifyLineAccessToken, fetchLineProfile } from "@/lib/lineAuth";
import { notifyAdmin } from "@/lib/adminNotify";

export const dynamic = "force-dynamic";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/auth/access-request
 * 利用者のセルフ利用申請。LIFFログイン済み（accessToken）だが未登録のユーザーが、
 * 氏名/メール/会社名を申請する。ここではメールを送らず、管理者の承認を待つ。
 *
 * Body: { accessToken: string, displayName: string, email: string, companyName: string }
 * - accessToken をサーバー側でLINE検証（lineUserId をクライアントから信頼しない）
 * - 既に登録済みなら alreadyRegistered を返す
 * - 同一 lineUserId の pending 申請は upsert（重複申請を作らない）
 */
export async function POST(req: NextRequest) {
  try {
    const clientIp = getClientIp(req);
    if (!checkRateLimit(`access-request:ip:${clientIp}`, 10, 10 * 60 * 1000)) {
      return NextResponse.json(
        { error: "リクエストが多すぎます。しばらく待ってからお試しください" },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => null);
    const accessToken: unknown = body?.accessToken;
    const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const companyName = typeof body?.companyName === "string" ? body.companyName.trim() : "";
    // 自己申告できるのは member / guest のみ（staffはURL招待の別導線。self-elevation防止）
    const requestedRole: "member" | "guest" = body?.requestedRole === "guest" ? "guest" : "member";

    if (!accessToken || typeof accessToken !== "string") {
      return NextResponse.json({ error: "LINEアクセストークンが必要です" }, { status: 400 });
    }
    if (!displayName) {
      return NextResponse.json({ error: "お名前を入力してください" }, { status: 400 });
    }
    if (!email || !EMAIL_REGEX.test(email)) {
      return NextResponse.json({ error: "メールアドレスの形式が正しくありません" }, { status: 400 });
    }
    if (!companyName) {
      return NextResponse.json({ error: "会社名を入力してください" }, { status: 400 });
    }

    // ── LINE アクセストークン検証 → lineUserId ──
    const tokenStatus = await verifyLineAccessToken(accessToken);
    if (tokenStatus !== "valid") {
      return NextResponse.json({ error: "LINE認証の有効期限が切れています。開き直してください" }, { status: 401 });
    }
    const profile = await fetchLineProfile(accessToken);
    if (!profile) {
      return NextResponse.json({ error: "LINEプロフィールの取得に失敗しました" }, { status: 401 });
    }
    const lineUserId = profile.userId;

    // lineUserId 単位のレートリミット（連投抑止）
    if (!checkRateLimit(`access-request:line:${lineUserId}`, 5, 10 * 60 * 1000)) {
      return NextResponse.json(
        { error: "申請が多すぎます。しばらく待ってからお試しください" },
        { status: 429 }
      );
    }

    const db = getDb();

    // 既に登録済み（この LINE で authorizedUser がある）なら申請不要
    const alreadyUser = await db
      .collection("authorizedUsers")
      .where("lineUserId", "==", lineUserId)
      .limit(1)
      .get();
    if (!alreadyUser.empty) {
      return NextResponse.json({ alreadyRegistered: true });
    }

    const nowStr = new Date().toISOString();

    // 同一 lineUserId の pending 申請があれば upsert（重複作成しない）
    const existingPending = await db
      .collection("accessRequests")
      .where("lineUserId", "==", lineUserId)
      .where("status", "==", "pending")
      .limit(1)
      .get();

    const payload = {
      lineUserId,
      lineDisplayName: profile.displayName ?? "",
      displayName,
      email,
      companyName,
      requestedRole,
      status: "pending" as const,
      createdAt: nowStr,
    };

    let requestId: string;
    if (!existingPending.empty) {
      const ref = existingPending.docs[0].ref;
      await ref.update({ displayName, email, companyName, requestedRole, createdAt: nowStr });
      requestId = ref.id;
    } else {
      const ref = await db.collection("accessRequests").add(payload);
      requestId = ref.id;
    }

    const roleLabel = requestedRole === "guest" ? "ゲスト" : "オフィス契約者";
    await notifyAdmin(
      "access_request",
      `利用申請が届きました：${displayName}（${roleLabel} / ${companyName} / ${email}）`,
      { requestId, lineUserId }
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[auth/access-request] error:", e instanceof Error ? e.message : "error");
    return NextResponse.json({ error: "申請の送信に失敗しました" }, { status: 500 });
  }
}
