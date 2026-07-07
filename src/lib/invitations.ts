/**
 * 招待作成の共通ロジック（管理者の手動招待・利用申請の承認の両方から使う）。
 * invitations + authorizedUsers をアトミックに作成し、身分に応じてメール送信する。
 */
import { getDb } from "@/lib/firebaseAdmin";
import { generatePasscode, hashPasscode } from "@/lib/passcode";
import { isGamesOnlyRole } from "@/lib/roles";
import { sendPasscodeEmail, sendGuestInviteEmail } from "@/lib/email";
import { liffUrl } from "@/lib/liffUrl";

export type InviteRole = "member" | "guest" | "staff";

const INVITATION_EXPIRY_DAYS = 7; // 会員（OTP方式）
const GUEST_INVITATION_EXPIRY_DAYS = 2; // ゲスト/社員（URL first-clicker方式・流出リスクで短め）
export const MAX_PASSCODE_ATTEMPTS = 5;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 身分ごとの招待有効期限日数。 */
export function expiryDaysForRole(role: InviteRole): number {
  return role === "member" ? INVITATION_EXPIRY_DAYS : GUEST_INVITATION_EXPIRY_DAYS;
}

/** ゲスト招待URL（LIFF URL）。踏むと /guest が開きその場でゲスト登録。 */
export function buildGuestInviteUrl(passcode: string): string {
  return liffUrl(`/guest?code=${encodeURIComponent(passcode)}`);
}
/** URL(first-clicker)方式で招待する身分か（ゲスト/社員）。会員はOTP方式。 */
export function usesUrlInvite(role: InviteRole): boolean {
  return isGamesOnlyRole(role);
}

export interface CreateInvitationResult {
  ok: boolean;
  status?: number; // エラー時のHTTPステータス
  error?: string;
  invitationId?: string;
  emailSent?: boolean;
  passcode?: string; // メール失敗時のみ手動共有用
  guestUrl?: string; // 同上（ゲスト/社員）
  expiresAt?: string;
}

/**
 * 招待を作成（OTP発行 + authorizedUser 作成 + メール送信）。
 * @param companyName 任意。指定時は本登録プロフィールの会社名として初期値に使う。
 */
export async function createInvitation(params: {
  displayName: string;
  email: string;
  role: InviteRole;
  companyName?: string;
}): Promise<CreateInvitationResult> {
  const displayName = (params.displayName ?? "").trim();
  const email = (params.email ?? "").trim().toLowerCase();
  const role = params.role;
  const companyName = (params.companyName ?? "").trim();

  if (!displayName) return { ok: false, status: 400, error: "名前を入力してください" };
  if (!email) return { ok: false, status: 400, error: "メールアドレスを入力してください" };
  if (!EMAIL_REGEX.test(email)) return { ok: false, status: 400, error: "メールアドレスの形式が正しくありません" };

  const db = getDb();

  // 同一メールの重複（authorizedUsers）
  const existing = await db.collection("authorizedUsers").where("email", "==", email).limit(1).get();
  if (!existing.empty) {
    return { ok: false, status: 409, error: "このメールアドレスは既に登録されています" };
  }

  // 重複しないパスコードを生成
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
      return { ok: false, status: 500, error: "パスコード生成に失敗しました。再試行してください" };
    }
  }

  const now = new Date();
  const expiryDays = expiryDaysForRole(role);
  const expiresAt = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);
  const nowStr = now.toISOString();

  const batch = db.batch();
  const inviteRef = db.collection("invitations").doc();
  batch.set(inviteRef, {
    displayName,
    email,
    passcodeHash: pHash,
    role,
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
    displayName,
    email,
    passwordHash: "",
    salt: "",
    lineUserId: null,
    active: true,
    role,
    profileComplete: false,
    createdAt: nowStr,
    lastLoginAt: null,
    invitationId: inviteRef.id,
    inviteStatus: "pending",
    // 申請由来の会社名は本登録プロフィールの初期値に使う。
    ...(companyName ? { profile: { companyName } } : {}),
  });

  await batch.commit();

  // メール送信（member=OTP / guest・staff=URL）
  let emailSent = false;
  try {
    if (usesUrlInvite(role)) {
      await sendGuestInviteEmail(email, displayName, buildGuestInviteUrl(passcode), expiryDays);
    } else {
      await sendPasscodeEmail(email, displayName, passcode);
    }
    emailSent = true;
    await inviteRef.update({ emailDeliveryStatus: "sent", emailSentAt: new Date().toISOString() });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : "Unknown error";
    console.error("[invitations] email send error:", errMsg);
    await inviteRef.update({ emailDeliveryStatus: "failed", emailError: errMsg });
  }

  return {
    ok: true,
    invitationId: inviteRef.id,
    emailSent,
    passcode: emailSent || usesUrlInvite(role) ? undefined : passcode,
    guestUrl: emailSent || !usesUrlInvite(role) ? undefined : buildGuestInviteUrl(passcode),
    expiresAt: expiresAt.toISOString(),
  };
}
