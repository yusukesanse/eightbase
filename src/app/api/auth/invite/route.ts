import { NextRequest, NextResponse } from "next/server";
import { signSession, setSessionCookie } from "@/lib/session";
import { getDb } from "@/lib/firebaseAdmin";
import { hashPasscode } from "@/lib/passcode";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const INVALID_MSG = "ワンタイムパスワードが無効です。正しいパスワードを入力してください";

/**
 * POST /api/auth/invite
 * ワンタイムパスワードで LINE ID を紐づける
 *
 * Body: { passcode: string, accessToken: string }
 *
 * セキュリティ:
 * - accessToken を LINE API でサーバー側検証（lineUserId をクライアントから信頼しない）
 * - パスコードは SHA-256 ハッシュで照合（DB に平文なし）
 * - IP / lineUserId 単位のレートリミット
 * - エラーメッセージを統一（存在/使用済み/期限切れを区別させない）
 * - Firestore transaction で原子的に消費
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { passcode, accessToken } = body;

    if (!passcode || typeof passcode !== "string") {
      return NextResponse.json({ error: "ワンタイムパスワードを入力してください" }, { status: 400 });
    }
    if (!accessToken || typeof accessToken !== "string") {
      return NextResponse.json({ error: "LINEアクセストークンが必要です" }, { status: 400 });
    }

    // ── IP レートリミット (10回/10分) ──
    const clientIp = getClientIp(req);
    if (!checkRateLimit(`invite:ip:${clientIp}`, 10, 10 * 60 * 1000)) {
      return NextResponse.json(
        { error: "リクエストが多すぎます。しばらく待ってからお試しください" },
        { status: 429 }
      );
    }

    // ── LINE API でアクセストークンを検証 ──
    const verifyRes = await fetch(
      `https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`
    );
    if (!verifyRes.ok) {
      return NextResponse.json({ error: "LINEアクセストークンが無効です" }, { status: 401 });
    }
    const verifyData = await verifyRes.json();
    if (verifyData.expires_in <= 0) {
      return NextResponse.json({ error: "LINEアクセストークンの有効期限が切れています" }, { status: 401 });
    }

    // ── LINE API でプロフィール取得 ──
    const profileRes = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profileRes.ok) {
      return NextResponse.json({ error: "LINEプロフィールの取得に失敗しました" }, { status: 401 });
    }
    const profile = await profileRes.json();
    const lineUserId: string = profile.userId;
    const lineDisplayName: string = profile.displayName || "";
    const linePictureUrl: string = profile.pictureUrl || "";

    if (!lineUserId) {
      return NextResponse.json({ error: "LINE ユーザーIDを取得できませんでした" }, { status: 401 });
    }

    // ── LINE userId レートリミット (5回/10分) ──
    if (!checkRateLimit(`invite:line:${lineUserId}`, 5, 10 * 60 * 1000)) {
      return NextResponse.json(
        { error: "リクエストが多すぎます。しばらく待ってからお試しください" },
        { status: 429 }
      );
    }

    const db = getDb();
    const pHash = hashPasscode(passcode);

    // ── ハッシュでパスコードを検索 ──
    const inviteSnap = await db
      .collection("invitations")
      .where("passcodeHash", "==", pHash)
      .limit(1)
      .get();

    if (inviteSnap.empty) {
      return NextResponse.json({ error: INVALID_MSG }, { status: 400 });
    }

    const inviteDocRef = inviteSnap.docs[0].ref;

    // ── Firestore transaction で原子的に消費 ──
    const result = await db.runTransaction(async (tx) => {
      const inviteDoc = await tx.get(inviteDocRef);
      if (!inviteDoc.exists) {
        return { error: INVALID_MSG, status: 400 };
      }

      const invite = inviteDoc.data()!;

      // 使用済み / 無効化 / 期限切れ → 統一メッセージ
      if (invite.usedAt || invite.lineUserId) {
        return { error: INVALID_MSG, status: 400 };
      }
      if (invite.revokedAt) {
        return { error: INVALID_MSG, status: 400 };
      }
      if (new Date(invite.expiresAt).getTime() < Date.now()) {
        return { error: INVALID_MSG, status: 400 };
      }

      // LINE ID 重複チェック（tx.get でクエリ）
      const existingSnap = await tx.get(
        db.collection("authorizedUsers").where("lineUserId", "==", lineUserId).limit(1)
      );
      if (!existingSnap.empty) {
        return { error: "このLINEアカウントは既に登録されています", status: 409, alreadyLinked: true };
      }

      const now = new Date().toISOString();

      // 招待時に作成済みの authorizedUsers を紐づけ
      const authSnap = await tx.get(
        db.collection("authorizedUsers").where("invitationId", "==", inviteDoc.id).limit(1)
      );

      if (!authSnap.empty) {
        const authData = authSnap.docs[0].data();
        // active=false のユーザーは連携を拒否
        if (authData.active === false) {
          return { error: INVALID_MSG, status: 400 };
        }
        tx.update(authSnap.docs[0].ref, {
          lineUserId,
          lastLoginAt: now,
          inviteStatus: "linked",
        });
      } else {
        const newRef = db.collection("authorizedUsers").doc();
        tx.set(newRef, {
          displayName: invite.displayName || lineDisplayName,
          lineUserId,
          active: true,
          profileComplete: false,
          createdAt: now,
          lastLoginAt: now,
          email: "",
          passwordHash: "",
          salt: "",
          invitationId: inviteDoc.id,
          inviteStatus: "linked",
        });
      }

      tx.update(inviteDocRef, { usedAt: now, lineUserId });

      return { success: true, displayName: invite.displayName || lineDisplayName, now };
    });

    if ("error" in result) {
      const resp: Record<string, unknown> = { error: result.error };
      if (result.alreadyLinked) resp.alreadyLinked = true;
      return NextResponse.json(resp, { status: result.status || 500 });
    }

    // users コレクションにも登録（transaction 外で OK）
    await db.collection("users").doc(lineUserId).set(
      {
        lineUserId,
        displayName: result.displayName,
        pictureUrl: linePictureUrl,
        lineDisplayName: lineDisplayName,
        createdAt: result.now,
        updatedAt: result.now,
      },
      { merge: true }
    );

    // セッション Cookie を発行
    const sessionToken = await signSession(lineUserId);
    const res = NextResponse.json({ success: true, needsProfile: true });
    setSessionCookie(res, sessionToken);
    return res;
  } catch (error) {
    console.error("[auth/invite] POST error:", error);
    return NextResponse.json({ error: "認証処理に失敗しました" }, { status: 500 });
  }
}
