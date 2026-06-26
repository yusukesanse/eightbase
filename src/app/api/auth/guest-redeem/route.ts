import { NextRequest, NextResponse } from "next/server";
import { signSession, setSessionCookie } from "@/lib/session";
import { getDb } from "@/lib/firebaseAdmin";
import { hashPasscode } from "@/lib/passcode";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { verifyLineAccessToken, fetchLineProfile } from "@/lib/lineAuth";

export const dynamic = "force-dynamic";

const INVALID_MSG = "この招待リンクは無効です（使用済み・期限切れの可能性があります）";

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
    if (!checkRateLimit(`guest:ip:${clientIp}`, 10, 10 * 60 * 1000)) {
      return NextResponse.json(
        { error: "リクエストが多すぎます。しばらく待ってからお試しください" },
        { status: 429 }
      );
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

    if (!checkRateLimit(`guest:line:${lineUserId}`, 5, 10 * 60 * 1000)) {
      return NextResponse.json(
        { error: "リクエストが多すぎます。しばらく待ってからお試しください" },
        { status: 429 }
      );
    }

    const db = getDb();
    const nowIso = new Date().toISOString();

    // ── 既にこのLINEが登録済みなら、トークンを消費せずログイン（会員/ゲスト両方） ──
    const existing = await db
      .collection("authorizedUsers")
      .where("lineUserId", "==", lineUserId)
      .where("active", "==", true)
      .limit(1)
      .get();
    if (!existing.empty) {
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

    // ── ゲスト招待を検索・原子的に消費 ──
    const pHash = hashPasscode(code);
    const inviteSnap = await db
      .collection("invitations")
      .where("passcodeHash", "==", pHash)
      .limit(1)
      .get();
    if (inviteSnap.empty) {
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
      // 並行で既に登録された → そのままログインさせる（トークンは既に他で消費済み）
      if (result.error === "ALREADY") {
        const sessionToken = await signSession(lineUserId);
        const res = NextResponse.json({ success: true, alreadyRegistered: true, role: "guest" });
        setSessionCookie(res, sessionToken);
        return res;
      }
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
