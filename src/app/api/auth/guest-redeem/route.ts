import { NextRequest, NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { signSession, setSessionCookie } from "@/lib/session";
import { getDb } from "@/lib/firebaseAdmin";
import { hashPasscode } from "@/lib/passcode";
import {
  checkRateLimit,
  getClientIp,
  recordFailure,
  isBlockedByFailures,
} from "@/lib/rateLimit";
import { verifyLineAccessToken, fetchLineProfile } from "@/lib/lineAuth";

export const dynamic = "force-dynamic";

const INVALID_MSG = "この招待リンクは無効です（使用済み・期限切れの可能性があります）";
const TOO_MANY_MSG = "リクエストが多すぎます。しばらく待ってからお試しください";

// レートリミット窓（10分）
const RL_WINDOW_MS = 10 * 60 * 1000;
// 招待コードhash単位: 総試行上限（window内）と、失敗が続いたら一時拒否する閾値
const CODE_MAX_ATTEMPTS = 10;
const CODE_MAX_FAILURES = 5;

/**
 * 既に登録済みの **有効な** LINE ユーザーとしてログインさせる。
 * - 招待トークンを消費しない（会員/ゲスト両対応・無駄打ち防止）。
 * - active な authorizedUsers が無ければ null（＝ここではログインさせない）。
 *
 * 直叩き・並行リダンプ時に、無効化済み(active=false)ユーザーを誤ってログインさせないための共通経路。
 */
async function loginExistingActiveUser(
  db: Firestore,
  lineUserId: string,
  linePictureUrl: string,
  lineDisplayName: string,
  nowIso: string
): Promise<NextResponse | null> {
  const existing = await db
    .collection("authorizedUsers")
    .where("lineUserId", "==", lineUserId)
    .where("active", "==", true)
    .limit(1)
    .get();
  if (existing.empty) return null;

  const ex = existing.docs[0].data();
  await db.collection("users").doc(lineUserId).set(
    { lineUserId, pictureUrl: linePictureUrl, lineDisplayName, updatedAt: nowIso },
    { merge: true }
  );
  const sessionToken = await signSession(lineUserId);
  const res = NextResponse.json({
    success: true,
    alreadyRegistered: true,
    role: ex.role === "guest" ? "guest" : "member",
    displayName: ex.displayName ?? lineDisplayName,
  });
  setSessionCookie(res, sessionToken);
  return res;
}

/**
 * POST /api/auth/guest-redeem
 * ゲスト招待のワンタイムURL(code)で LINE ID を紐づけ、ゲストとして登録する。
 * Body: { code: string, accessToken: string }
 *
 * - 既にこのLINEが登録済み(member/guest)なら、トークンを消費せずそのままログイン
 *   （無駄打ち防止・会員優先）。
 * - 未登録なら guest 招待を transaction で原子的に消費し、事前作成済みの guest レコードを紐づける。
 * - 会員フロー(/api/auth/invite)は変更しない（ゲストは別エンドポイントに分離）。
 */
export async function POST(req: NextRequest) {
  try {
    const { code, accessToken } = await req.json();
    if (!code || typeof code !== "string") {
      return NextResponse.json({ error: "招待コードが必要です" }, { status: 400 });
    }
    if (!accessToken || typeof accessToken !== "string") {
      return NextResponse.json({ error: "LINEアクセストークンが必要です" }, { status: 400 });
    }

    // ── IP レートリミット ──
    const clientIp = getClientIp(req);
    if (!checkRateLimit(`guest:ip:${clientIp}`, 10, RL_WINDOW_MS)) {
      return NextResponse.json({ error: TOO_MANY_MSG }, { status: 429 });
    }

    // ── 招待コードhash単位のレートリミット（コード総当たり対策） ──
    // 平文コードではなく hash をキーにする（ログ/メモリに平文を残さない）。
    const pHash = hashPasscode(code);
    const codeKey = `guest:code:${pHash}`;
    // 失敗が続いているコードは一時拒否（有効/無効を問わず総当たりを止める）。
    if (
      isBlockedByFailures(codeKey, CODE_MAX_FAILURES) ||
      !checkRateLimit(codeKey, CODE_MAX_ATTEMPTS, RL_WINDOW_MS)
    ) {
      return NextResponse.json({ error: TOO_MANY_MSG }, { status: 429 });
    }

    // ── LINE アクセストークン検証 → プロフィール取得 ──
    const tokenStatus = await verifyLineAccessToken(accessToken);
    if (tokenStatus === "invalid") {
      return NextResponse.json({ error: "LINEアクセストークンが無効です" }, { status: 401 });
    }
    if (tokenStatus === "expired") {
      return NextResponse.json({ error: "LINEアクセストークンの有効期限が切れています" }, { status: 401 });
    }
    const profile = await fetchLineProfile(accessToken);
    if (!profile) {
      return NextResponse.json({ error: "LINEプロフィールの取得に失敗しました" }, { status: 401 });
    }
    const lineUserId = profile.userId;
    const lineDisplayName = profile.displayName;
    const linePictureUrl = profile.pictureUrl;

    if (!checkRateLimit(`guest:line:${lineUserId}`, 5, RL_WINDOW_MS)) {
      return NextResponse.json({ error: TOO_MANY_MSG }, { status: 429 });
    }

    const db = getDb();
    const nowIso = new Date().toISOString();

    // ── 既にこのLINEが登録済み(active)なら、トークンを消費せずログイン（会員/ゲスト両方） ──
    const existingLogin = await loginExistingActiveUser(
      db,
      lineUserId,
      linePictureUrl,
      lineDisplayName,
      nowIso
    );
    if (existingLogin) return existingLogin;

    // ── ゲスト招待を検索・原子的に消費 ──
    const inviteSnap = await db
      .collection("invitations")
      .where("passcodeHash", "==", pHash)
      .limit(1)
      .get();
    if (inviteSnap.empty) {
      // 存在しないコード＝総当たりの兆候。失敗として記録し閾値超で一時拒否する。
      recordFailure(codeKey, RL_WINDOW_MS);
      return NextResponse.json({ error: INVALID_MSG }, { status: 400 });
    }
    const inviteDocRef = inviteSnap.docs[0].ref;

    const result = await db.runTransaction(async (tx) => {
      const inviteDoc = await tx.get(inviteDocRef);
      if (!inviteDoc.exists) return { error: INVALID_MSG, status: 400 };
      const invite = inviteDoc.data()!;

      // ゲスト招待であること
      if (invite.role !== "guest") return { error: INVALID_MSG, status: 400 };
      // 使用済み / 無効化 / 期限切れ
      if (invite.usedAt || invite.lineUserId) return { error: INVALID_MSG, status: 400 };
      if (invite.revokedAt) return { error: INVALID_MSG, status: 400 };
      if (new Date(invite.expiresAt).getTime() < Date.now()) return { error: INVALID_MSG, status: 400 };

      // LINE 重複（並行リダンプ対策）
      const dupSnap = await tx.get(
        db.collection("authorizedUsers").where("lineUserId", "==", lineUserId).limit(1)
      );
      if (!dupSnap.empty) return { error: "ALREADY", status: 409 };

      // 事前作成済みの guest authorizedUsers を紐づけ（無ければ新規作成）
      let displayName: string = invite.displayName || lineDisplayName;
      const authSnap = await tx.get(
        db.collection("authorizedUsers").where("invitationId", "==", inviteDoc.id).limit(1)
      );
      if (!authSnap.empty) {
        const authData = authSnap.docs[0].data();
        if (authData.active === false) return { error: INVALID_MSG, status: 400 };
        displayName = authData.displayName || displayName;
        tx.update(authSnap.docs[0].ref, {
          lineUserId,
          lastLoginAt: nowIso,
          inviteStatus: "linked",
        });
      } else {
        const newRef = db.collection("authorizedUsers").doc();
        tx.set(newRef, {
          displayName,
          lineUserId,
          active: true,
          role: "guest",
          profileComplete: false,
          createdAt: nowIso,
          lastLoginAt: nowIso,
          email: "",
          passwordHash: "",
          salt: "",
          invitationId: inviteDoc.id,
          inviteStatus: "linked",
        });
      }

      tx.update(inviteDocRef, { usedAt: nowIso, lineUserId });
      return { success: true, displayName };
    });

    if ("error" in result) {
      // 並行で既に登録された → 改めて active ユーザーを確認してからログインさせる。
      // （active=false の無効化済みユーザーをそのままログインさせない・role も実データで判定）
      if (result.error === "ALREADY") {
        const login = await loginExistingActiveUser(
          db,
          lineUserId,
          linePictureUrl,
          lineDisplayName,
          nowIso
        );
        if (login) return login;
        // active なユーザーが見つからない（無効化済み等）→ 招待は無効として扱う。
        return NextResponse.json({ error: INVALID_MSG }, { status: 400 });
      }
      // 招待が無効/期限切れ/使用済み等 → 失敗として記録（総当たり検知）。
      recordFailure(codeKey, RL_WINDOW_MS);
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    // users コレクション作成（順位表の表示名/アバター元）
    await db.collection("users").doc(lineUserId).set(
      {
        lineUserId,
        displayName: result.displayName,
        pictureUrl: linePictureUrl,
        lineDisplayName,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      { merge: true }
    );

    const sessionToken = await signSession(lineUserId);
    const res = NextResponse.json({ success: true, guest: true, displayName: result.displayName });
    setSessionCookie(res, sessionToken);
    return res;
  } catch (error) {
    console.error("[auth/guest-redeem] POST error:", error);
    return NextResponse.json({ error: "認証処理に失敗しました" }, { status: 500 });
  }
}
