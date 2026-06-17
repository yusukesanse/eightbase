import { NextRequest, NextResponse } from "next/server";
import { signSession, setSessionCookie } from "@/lib/session";
import { getDb } from "@/lib/firebaseAdmin";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/invite
 * ワンタイム招待トークンで LINE ID を紐づける
 *
 * Body: { token: string, accessToken: string }
 *
 * accessToken を LINE API で検証してサーバー側で lineUserId を取得する。
 * liff-login のセッションには依存しない。
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token, accessToken } = body;

    if (!token || typeof token !== "string") {
      return NextResponse.json({ error: "招待トークンが必要です" }, { status: 400 });
    }
    if (!accessToken || typeof accessToken !== "string") {
      return NextResponse.json({ error: "LINEアクセストークンが必要です" }, { status: 400 });
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

    // ── LINE API でプロフィール取得（サーバー側で lineUserId を確定） ──
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

    const db = getDb();

    // ── トークンで招待を検索 ──
    const inviteSnap = await db
      .collection("invitations")
      .where("token", "==", token)
      .limit(1)
      .get();

    if (inviteSnap.empty) {
      return NextResponse.json({ error: "無効な招待URLです" }, { status: 404 });
    }

    const inviteDocRef = inviteSnap.docs[0].ref;

    // ── Firestore transaction で招待消費 + ユーザー作成を原子的に実行 ──
    const result = await db.runTransaction(async (tx) => {
      const inviteDoc = await tx.get(inviteDocRef);
      if (!inviteDoc.exists) {
        return { error: "無効な招待URLです", status: 404 };
      }

      const invite = inviteDoc.data()!;

      // 使用済みチェック
      if (invite.usedAt || invite.lineUserId) {
        return { error: "この招待URLは既に使用されています", status: 410 };
      }

      // 有効期限チェック
      if (new Date(invite.expiresAt).getTime() < Date.now()) {
        return { error: "この招待URLの有効期限が切れています。管理者に再発行を依頼してください", status: 410 };
      }

      // 既にこの LINE ID で登録済みか確認
      const existingSnap = await db
        .collection("authorizedUsers")
        .where("lineUserId", "==", lineUserId)
        .limit(1)
        .get();

      if (!existingSnap.empty) {
        return { error: "このLINEアカウントは既に登録されています", status: 409, alreadyLinked: true };
      }

      const now = new Date().toISOString();

      // 招待時に作成済みの authorizedUsers を検索して LINE ID を紐づけ
      const authSnap = await db
        .collection("authorizedUsers")
        .where("invitationId", "==", inviteDoc.id)
        .limit(1)
        .get();

      if (!authSnap.empty) {
        tx.update(authSnap.docs[0].ref, {
          lineUserId,
          lastLoginAt: now,
        });
      } else {
        // フォールバック: 旧招待データ等で authorizedUsers がない場合
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
        });
      }

      // 招待を使用済みに更新
      tx.update(inviteDocRef, {
        usedAt: now,
        lineUserId,
      });

      return { success: true, displayName: invite.displayName || lineDisplayName, now };
    });

    // トランザクション結果を確認
    if ("error" in result) {
      const status = result.status || 500;
      const resp: Record<string, unknown> = { error: result.error };
      if (result.alreadyLinked) resp.alreadyLinked = true;
      return NextResponse.json(resp, { status });
    }

    // users コレクションにも登録（トランザクション外で OK）
    const userRef = db.collection("users").doc(lineUserId);
    await userRef.set(
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

    // セッション Cookie を発行（プロフィール登録画面で認証が必要なため）
    const sessionToken = await signSession(lineUserId);
    const res = NextResponse.json({ success: true, needsProfile: true });
    setSessionCookie(res, sessionToken);
    return res;
  } catch (error) {
    console.error("[auth/invite] POST error:", error);
    return NextResponse.json({ error: "招待の処理に失敗しました" }, { status: 500 });
  }
}
