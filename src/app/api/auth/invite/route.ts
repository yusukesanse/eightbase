import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { getDb } from "@/lib/firebaseAdmin";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/invite
 * ワンタイム招待トークンで LINE ID を紐づける
 *
 * Body: { token: string }
 *
 * 前提: LIFF ログイン済み（セッション Cookie あり）
 */
export async function POST(req: NextRequest) {
  try {
    const lineUserId = await getSessionUserId(req);
    if (!lineUserId) {
      return NextResponse.json({ error: "LINEログインが必要です" }, { status: 401 });
    }

    const { token } = await req.json();
    if (!token || typeof token !== "string") {
      return NextResponse.json({ error: "招待トークンが必要です" }, { status: 400 });
    }

    const db = getDb();

    // トークンで招待を検索
    const snap = await db
      .collection("invitations")
      .where("token", "==", token)
      .limit(1)
      .get();

    if (snap.empty) {
      return NextResponse.json({ error: "無効な招待URLです" }, { status: 404 });
    }

    const inviteDoc = snap.docs[0];
    const invite = inviteDoc.data();

    // 使用済みチェック
    if (invite.usedAt || invite.lineUserId) {
      return NextResponse.json({ error: "この招待URLは既に使用されています" }, { status: 410 });
    }

    // 有効期限チェック
    if (new Date(invite.expiresAt).getTime() < Date.now()) {
      return NextResponse.json({ error: "この招待URLの有効期限が切れています。管理者に再発行を依頼してください" }, { status: 410 });
    }

    // 既にこの LINE ID で登録済みか確認
    const existingUser = await db
      .collection("authorizedUsers")
      .where("lineUserId", "==", lineUserId)
      .limit(1)
      .get();

    if (!existingUser.empty) {
      return NextResponse.json({ error: "このLINEアカウントは既に登録されています", alreadyLinked: true });
    }

    const now = new Date().toISOString();

    // authorizedUsers に新規ユーザーを作成
    await db.collection("authorizedUsers").add({
      displayName: invite.displayName || "",
      lineUserId,
      active: true,
      profileComplete: false,
      createdAt: now,
      lastLoginAt: now,
      // 旧方式のフィールドは空にしておく（後方互換）
      email: "",
      passwordHash: "",
      salt: "",
    });

    // 招待を使用済みに更新
    await inviteDoc.ref.update({
      usedAt: now,
      lineUserId,
    });

    // users コレクションにも登録
    const userRef = db.collection("users").doc(lineUserId);
    await userRef.set(
      {
        lineUserId,
        displayName: invite.displayName || "",
        createdAt: now,
        updatedAt: now,
      },
      { merge: true }
    );

    return NextResponse.json({ success: true, needsProfile: true });
  } catch (error) {
    console.error("[auth/invite] POST error:", error);
    return NextResponse.json({ error: "招待の処理に失敗しました" }, { status: 500 });
  }
}
