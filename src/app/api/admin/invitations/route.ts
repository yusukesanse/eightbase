import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/adminAuth";
import { isDummyDataEnabled } from "@/lib/env";
import { dummyAdminInvitations } from "@/lib/previewDummyAdmin";
import { getDb } from "@/lib/firebaseAdmin";
import { generatePasscode, hashPasscode } from "@/lib/passcode";
import { sendPasscodeEmail, sendGuestInviteEmail } from "@/lib/email";
import { liffUrl } from "@/lib/liffUrl";

export const dynamic = "force-dynamic";

/** ゲスト招待URL（LIFF URL）。踏むと LINEミニアプリの /guest が開き、その場でゲスト登録される。 */
function buildGuestInviteUrl(passcode: string): string {
  return liffUrl(`/guest?code=${encodeURIComponent(passcode)}`);
}

// 会員招待の有効期限（メール入力式のワンタイムパスワード）
const INVITATION_EXPIRY_DAYS = 7;
// ゲスト招待の有効期限。ゲストURLは "最初に開いた1名" が登録できる first-clicker 方式で
// 流出時のリスクが高いため、会員より短くする（別定数）。
const GUEST_INVITATION_EXPIRY_DAYS = 2;
const MAX_PASSCODE_ATTEMPTS = 5;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 身分ごとの有効期限日数を返す。 */
function expiryDaysForRole(role: "member" | "guest"): number {
  return role === "guest" ? GUEST_INVITATION_EXPIRY_DAYS : INVITATION_EXPIRY_DAYS;
}

/**
 * GET /api/admin/invitations
 * 招待一覧（ステータス付き、パスコードは返さない）
 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (isDummyDataEnabled()) {
    return NextResponse.json(dummyAdminInvitations);
  }

  try {
    const db = getDb();
    const snap = await db.collection("invitations").orderBy("createdAt", "desc").get();
    const now = Date.now();

    const invitations = snap.docs.map((doc) => {
      const d = doc.data();
      const usedAt = d.usedAt as string | null;
      const lineUserId = d.lineUserId as string | null;
      const expiresAt = d.expiresAt as string;

      let status: "unused" | "used" | "expired" | "revoked" = "unused";
      if (d.revokedAt) {
        status = "revoked";
      } else if (usedAt || lineUserId) {
        status = "used";
      } else if (new Date(expiresAt).getTime() < now) {
        status = "expired";
      }

      return {
        id: doc.id,
        displayName: d.displayName || "",
        email: (d.email as string) || "",
        role: (d.role as string) || "member",
        status,
        emailDeliveryStatus: (d.emailDeliveryStatus as string) || "unknown",
        createdAt: d.createdAt as string,
        expiresAt,
        usedAt: usedAt || null,
      };
    });

    return NextResponse.json({ invitations });
  } catch (error) {
    console.error("[admin/invitations] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

/**
 * POST /api/admin/invitations
 * 新規招待を作成（ワンタイムパスコード発行 + メール送信）
 *
 * Body: { displayName: string, email: string }
 *
 * - email を正規化・形式検証
 * - authorizedUsers の同一 email 重複を 409 で拒否
 * - invitations + authorizedUsers を batch でアトミックに作成
 * - メール送信結果を emailDeliveryStatus として保存
 * - メール送信成功時は平文 passcode をレスポンスに含めない
 */
export async function POST(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { displayName, email, role: rawRole } = await req.json();
    const role: "member" | "guest" = rawRole === "guest" ? "guest" : "member";
    if (!displayName || typeof displayName !== "string" || !displayName.trim()) {
      return NextResponse.json({ error: "名前を入力してください" }, { status: 400 });
    }
    if (!email || typeof email !== "string" || !email.trim()) {
      return NextResponse.json({ error: "メールアドレスを入力してください" }, { status: 400 });
    }

    const trimmedEmail = email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(trimmedEmail)) {
      return NextResponse.json({ error: "メールアドレスの形式が正しくありません" }, { status: 400 });
    }

    const db = getDb();

    // 同一メールアドレスの重複チェック（authorizedUsers）
    const existingUser = await db
      .collection("authorizedUsers")
      .where("email", "==", trimmedEmail)
      .limit(1)
      .get();
    if (!existingUser.empty) {
      return NextResponse.json({ error: "このメールアドレスは既に登録されています" }, { status: 409 });
    }

    // 重複チェック付きパスコード生成（最大5回）
    let passcode = "";
    let pHash = "";
    for (let i = 0; i < MAX_PASSCODE_ATTEMPTS; i++) {
      passcode = generatePasscode();
      pHash = hashPasscode(passcode);
      const dup = await db
        .collection("invitations")
        .where("passcodeHash", "==", pHash)
        .where("usedAt", "==", null)
        .limit(1)
        .get();
      if (dup.empty) break;
      if (i === MAX_PASSCODE_ATTEMPTS - 1) {
        return NextResponse.json({ error: "パスコード生成に失敗しました。再試行してください" }, { status: 500 });
      }
    }

    const now = new Date();
    const expiryDays = expiryDaysForRole(role);
    const expiresAt = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);
    const nowStr = now.toISOString();
    const trimmedName = displayName.trim();

    // invitations + authorizedUsers をアトミックに作成
    const batch = db.batch();
    const inviteRef = db.collection("invitations").doc();
    batch.set(inviteRef, {
      displayName: trimmedName,
      email: trimmedEmail,
      passcodeHash: pHash,
      role, // 身分（member|guest）
      emailDeliveryStatus: "pending",
      emailSentAt: null,
      emailError: null,
      createdAt: nowStr,
      expiresAt: expiresAt.toISOString(),
      usedAt: null,
      lineUserId: null,
      revokedAt: null,
    });

    const authRef = db.collection("authorizedUsers").doc();
    batch.set(authRef, {
      displayName: trimmedName,
      email: trimmedEmail,
      passwordHash: "",
      salt: "",
      lineUserId: null,
      active: true,
      role, // 身分（member|guest）。guest はゲーム機能のみ。
      profileComplete: false,
      createdAt: nowStr,
      lastLoginAt: null,
      invitationId: inviteRef.id,
      inviteStatus: "pending",
    });

    await batch.commit();

    // メール送信（DB作成後に実行、結果をinvitationに反映）
    // member: ワンタイムパスコード（ログイン画面で入力）/ guest: ワンタイムURL（踏むと登録）
    let emailSent = false;
    try {
      if (role === "guest") {
        await sendGuestInviteEmail(trimmedEmail, trimmedName, buildGuestInviteUrl(passcode), expiryDays);
      } else {
        await sendPasscodeEmail(trimmedEmail, trimmedName, passcode);
      }
      emailSent = true;
      await inviteRef.update({
        emailDeliveryStatus: "sent",
        emailSentAt: new Date().toISOString(),
      });
    } catch (emailError) {
      const errMsg = emailError instanceof Error ? emailError.message : "Unknown error";
      console.error("[admin/invitations] Email send error:", errMsg);
      await inviteRef.update({
        emailDeliveryStatus: "failed",
        emailError: errMsg,
      });
    }

    // メール送信成功時は平文パスコード/URLを返さない（失敗時のみ手動共有用に返す）
    return NextResponse.json({
      success: true,
      id: inviteRef.id,
      role,
      passcode: emailSent || role === "guest" ? undefined : passcode,
      guestUrl: emailSent || role !== "guest" ? undefined : buildGuestInviteUrl(passcode),
      emailSent,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error("[admin/invitations] POST error:", error);
    return NextResponse.json({ error: "招待の作成に失敗しました" }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/invitations
 * パスコードを再発行（新ハッシュで上書き、有効期限リセット、メール再送）
 *
 * Body: { id: string }
 */
export async function PATCH(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await req.json();
    if (!id) {
      return NextResponse.json({ error: "IDは必須です" }, { status: 400 });
    }

    const db = getDb();
    const docRef = db.collection("invitations").doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return NextResponse.json({ error: "招待が見つかりません" }, { status: 404 });
    }

    const data = doc.data()!;
    if (data.usedAt || data.lineUserId) {
      return NextResponse.json({ error: "使用済みの招待は再発行できません" }, { status: 400 });
    }
    if (data.revokedAt) {
      return NextResponse.json({ error: "無効化された招待は再発行できません" }, { status: 400 });
    }

    // パスコードハッシュ重複チェック付き生成
    let passcode = "";
    let pHash = "";
    for (let i = 0; i < MAX_PASSCODE_ATTEMPTS; i++) {
      passcode = generatePasscode();
      pHash = hashPasscode(passcode);
      const dup = await db
        .collection("invitations")
        .where("passcodeHash", "==", pHash)
        .where("usedAt", "==", null)
        .limit(1)
        .get();
      if (dup.empty) break;
      if (i === MAX_PASSCODE_ATTEMPTS - 1) {
        return NextResponse.json({ error: "パスコード生成に失敗しました。再試行してください" }, { status: 500 });
      }
    }

    // 再発行時も身分に応じた有効期限（ゲストは短縮）でリセットする。
    const role = data.role === "guest" ? "guest" : "member";
    const expiryDays = expiryDaysForRole(role);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);

    await docRef.update({
      passcodeHash: pHash,
      expiresAt: expiresAt.toISOString(),
      emailDeliveryStatus: "pending",
      emailSentAt: null,
      emailError: null,
    });

    // メール再送（member: パスコード / guest: ワンタイムURL）
    let emailSent = false;
    const savedEmail = data.email as string | undefined;
    if (savedEmail) {
      try {
        if (role === "guest") {
          await sendGuestInviteEmail(savedEmail, data.displayName || "", buildGuestInviteUrl(passcode), expiryDays);
        } else {
          await sendPasscodeEmail(savedEmail, data.displayName || "", passcode);
        }
        emailSent = true;
        await docRef.update({
          emailDeliveryStatus: "sent",
          emailSentAt: new Date().toISOString(),
        });
      } catch (emailError) {
        const errMsg = emailError instanceof Error ? emailError.message : "Unknown error";
        console.error("[admin/invitations] Email resend error:", errMsg);
        await docRef.update({
          emailDeliveryStatus: "failed",
          emailError: errMsg,
        });
      }
    }

    // メール送信成功時は平文パスコード/URLを返さない（失敗時のみ手動共有用に返す）
    return NextResponse.json({
      success: true,
      role,
      passcode: emailSent || role === "guest" ? undefined : passcode,
      guestUrl: emailSent || role !== "guest" ? undefined : buildGuestInviteUrl(passcode),
      emailSent,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error("[admin/invitations] PATCH error:", error);
    return NextResponse.json({ error: "再発行に失敗しました" }, { status: 500 });
  }
}
