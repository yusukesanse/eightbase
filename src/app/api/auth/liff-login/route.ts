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

    // ── 審査モードを先に取得（トークン検証失敗時のフォールバック判定に使用）──
    const db = getDb();
    let isReviewMode = false;
    try {
      const settingsDoc = await db.collection("settings").doc("app").get();
      isReviewMode = settingsDoc.exists && settingsDoc.data()?.reviewMode === true;
    } catch (e) {
      console.warn("[liff-login] settings fetch error:", e);
    }

    // ── 1. LINE API でアクセストークンを検証 ──
    let tokenValid = false;
    try {
      const verifyRes = await fetch(
        `https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`
      );

      if (verifyRes.ok) {
        const verifyData = await verifyRes.json();
        tokenValid = verifyData.expires_in > 0;
      } else {
        console.warn("[liff-login] token verify failed:", await verifyRes.text());
      }
    } catch (e) {
      console.warn("[liff-login] token verify error:", e);
    }

    if (!tokenValid && !isReviewMode) {
      return NextResponse.json(
        { error: "無効なアクセストークンです" },
        { status: 401 }
      );
    }

    if (!tokenValid && isReviewMode) {
      console.log("[liff-login] review mode: skipping token verification");
    }

    // ── 2. LINE API でユーザープロフィールを取得（失敗時はクライアント側プロフィールをフォールバック）──
    let lineUserId = "";
    let displayName = "";
    let pictureUrl = "";

    if (tokenValid) {
      const profileRes = await fetch("https://api.line.me/v2/profile", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (profileRes.ok) {
        const profile = await profileRes.json();
        lineUserId = profile.userId;
        displayName = profile.displayName;
        pictureUrl = profile.pictureUrl ?? "";
      } else {
        const errText = await profileRes.text();
        console.warn("[liff-login] server-side profile fetch failed:", errText);
      }
    }

    // サーバー側で取得できなかった場合、クライアント側プロフィールをフォールバック
    if (!lineUserId && liffProfile?.userId) {
      console.log("[liff-login] using client-side profile as fallback");
      lineUserId = liffProfile.userId;
      displayName = liffProfile.displayName ?? "";
      pictureUrl = liffProfile.pictureUrl ?? "";
    }

    if (!lineUserId) {
      console.error("[liff-login] no profile available");
      return NextResponse.json(
        { error: "プロフィール取得に失敗しました。LINEアプリからアクセスしてください。" },
        { status: 401 }
      );
    }

    console.log(`[liff-login] LINE user: ${displayName} (${lineUserId})`);

    // ── 3. authorizedUsers で lineUserId を照合 ──
    const snap = await db
      .collection("authorizedUsers")
      .where("lineUserId", "==", lineUserId)
      .where("active", "==", true)
      .limit(1)
      .get();

    if (snap.empty && !isReviewMode) {
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

    if (snap.empty && isReviewMode) {
      console.log(`[liff-login] review mode: allowing unregistered user ${displayName} (${lineUserId})`);
    }

    // ── 4. 連携済み or 審査モード → セッション発行 ──
    const userData = snap.empty ? null : snap.docs[0].data();
    const profileComplete = snap.empty ? true : !!userData?.profileComplete;

    // users コレクションに LINE 表示名を同期
    const userRef = db.collection("users").doc(lineUserId);
    await userRef.set(
      {
        displayName: userData?.displayName || displayName,
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
      displayName: userData?.displayName || displayName,
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
