import { NextRequest, NextResponse } from "next/server";
import { signSession, setSessionCookie } from "@/lib/session";
import { getDb } from "@/lib/firebaseAdmin";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/liff-login
 *
 * ハイブリッド認証フロー:
 * 1. LIFF アクセストークンを LINE API で検証
 * 2. LINE プロフィールを取得
 * 3. authorizedUsers コレクションで lineUserId を照合
 *    - 連携済み → セッション発行 (profileComplete フラグ付き)
 *    - 未連携 → needsLinking: true を返す
 */
export async function POST(req: NextRequest) {
  try {
    const { accessToken, liffProfile } = await req.json();

    if (!accessToken || typeof accessToken !== "string") {
      return NextResponse.json(
        { error: "アクセストークンがありません" },
        { status: 400 }
      );
    }

    // ── 1. LINE API でアクセストークンを検証 ──
    const verifyRes = await fetch(
      `https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`
    );

    if (!verifyRes.ok) {
      console.error("[liff-login] token verify failed:", await verifyRes.text());
      return NextResponse.json(
        { error: "無効なアクセストークンです" },
        { status: 401 }
      );
    }

    const verifyData = await verifyRes.json();
    if (verifyData.expires_in <= 0) {
      return NextResponse.json(
        { error: "アクセストークンが期限切れです" },
        { status: 401 }
      );
    }

    // ── 2. LINE API でユーザープロフィールを取得（失敗時はクライアント側プロフィールをフォールバック）──
    let lineUserId = "";
    let displayName = "";
    let pictureUrl = "";

    const profileRes = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (profileRes.ok) {
      const profile = await profileRes.json();
      lineUserId = profile.userId;
      displayName = profile.displayName;
      pictureUrl = profile.pictureUrl ?? "";
    } else {
      // サーバー側 LINE API 失敗 → クライアント側 liff.getProfile() の結果を使用
      const errText = await profileRes.text();
      console.warn("[liff-login] server-side profile fetch failed, using client profile:", errText);

      if (liffProfile?.userId) {
        lineUserId = liffProfile.userId;
        displayName = liffProfile.displayName ?? "";
        pictureUrl = liffProfile.pictureUrl ?? "";
      } else {
        console.error("[liff-login] no fallback profile available");
        return NextResponse.json(
          { error: "プロフィール取得に失敗しました。LINEアプリからアクセスしてください。" },
          { status: 401 }
        );
      }
    }

    console.log(`[liff-login] LINE user: ${displayName} (${lineUserId})`);

    // ── 3. authorizedUsers で lineUserId を照合 ──
    const db = getDb();
    const snap = await db
      .collection("authorizedUsers")
      .where("lineUserId", "==", lineUserId)
      .where("active", "==", true)
      .limit(1)
      .get();

    if (snap.empty) {
      // lineUserId が未連携 → アカウント連携が必要
      console.log(`[liff-login] lineUserId not linked: ${lineUserId}`);
      return NextResponse.json({
        success: false,
        needsLinking: true,
        lineUserId,
        displayName,
        pictureUrl,
      });
    }

    // ── 4. 連携済み → プロフィール完了チェック & セッション発行 ──
    const userData = snap.docs[0].data();
    const profileComplete = !!userData.profileComplete;

    // users コレクションに LINE 表示名を同期
    const userRef = db.collection("users").doc(lineUserId);
    await userRef.set(
      {
        displayName: userData.displayName || displayName,
        lineDisplayName: displayName,
        pictureUrl,
        lineUserId,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    const token = await signSession(lineUserId);

    const res = NextResponse.json({
      success: true,
      displayName: userData.displayName || displayName,
      lineUserId,
      profileComplete,
    });

    setSessionCookie(res, token);
    return res;
  } catch (error) {
    console.error("[liff-login] error:", error);
    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}
