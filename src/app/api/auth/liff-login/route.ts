import { NextRequest, NextResponse } from "next/server";
import { signSession, setSessionCookie } from "@/lib/session";
import { getDb } from "@/lib/firebaseAdmin";
import { verifyLineAccessToken, fetchLineProfile } from "@/lib/lineAuth";
import { isReviewModeEnabled } from "@/lib/reviewMode";

export const dynamic = "force-dynamic";

/** 未連携ユーザーに返す「申請中」の中身（表示用。ロールの付与ではない）。 */
interface PendingAccessRequest {
  displayName: string;
  email: string;
  requestedRole: "member" | "staff" | "guest";
  createdAt: string;
}

/**
 * この LINE ユーザーの pending な利用申請を1件返す（無ければ null）。
 * 表示用の付加情報なので、読み取りに失敗してもログインは止めずに null を返す。
 */
async function fetchPendingAccessRequest(
  db: ReturnType<typeof getDb>,
  lineUserId: string
): Promise<PendingAccessRequest | null> {
  try {
    const snap = await db
      .collection("accessRequests")
      .where("lineUserId", "==", lineUserId)
      .where("status", "==", "pending")
      .limit(1)
      .get();
    if (snap.empty) return null;

    const d = snap.docs[0].data() as Record<string, unknown>;
    const role = d?.requestedRole;
    return {
      displayName: typeof d?.displayName === "string" ? d.displayName : "",
      email: typeof d?.email === "string" ? d.email : "",
      requestedRole: role === "guest" ? "guest" : role === "staff" ? "staff" : "member",
      createdAt: typeof d?.createdAt === "string" ? d.createdAt : "",
    };
  } catch (e) {
    console.warn("[liff-login] pending access request lookup failed:", e);
    return null;
  }
}

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
    const { accessToken } = await req.json();

    if (!accessToken || typeof accessToken !== "string") {
      return NextResponse.json(
        { error: "アクセストークンがありません" },
        { status: 400 }
      );
    }

    // ── 審査モードを取得（本番では環境変数で明示的に許可しない限り無効）──
    const db = getDb();
    const isReviewMode = await isReviewModeEnabled(db);

    // ── 1. LINE API でアクセストークンを検証 ──
    const tokenValid = (await verifyLineAccessToken(accessToken)) === "valid";

    if (!tokenValid && !isReviewMode) {
      return NextResponse.json(
        { error: "無効なアクセストークンです" },
        { status: 401 }
      );
    }

    if (!tokenValid && isReviewMode) {
      console.log("[liff-login] review mode: skipping token verification");
    }

    // ── 2. LINE API でユーザープロフィールを取得 ──
    let lineUserId = "";
    let displayName = "";
    let pictureUrl = "";

    if (tokenValid) {
      const profile = await fetchLineProfile(accessToken);
      if (profile) {
        lineUserId = profile.userId;
        displayName = profile.displayName;
        pictureUrl = profile.pictureUrl;
      }
    }

    if (!lineUserId && isReviewMode) {
      lineUserId = process.env.REVIEW_LINE_USER_ID ?? "review-user";
      displayName = process.env.REVIEW_LINE_DISPLAY_NAME ?? "LINE審査ユーザー";
      pictureUrl = "";
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
      // lineUserId が未連携。
      // メール招待方式では「この LINE ユーザーが招待済みか」を lineUserId だけでは判定できない
      // （ワンタイムパスワードの入力こそが招待の証明）。
      // 以前は「pending 招待が1件でもあれば全未連携ユーザーに needsLinking」を返していたが、
      // それだと未招待ユーザーにも OTP 画面が出てしまうため廃止。
      // ここでは「未連携」であることだけを返し、OTP 入力は明示導線(/login)でのみ表示する。
      // ホーム(/) では未連携=「招待が必要」案内を出す（page.tsx 側で分岐）。
      console.log(`[liff-login] lineUserId not linked: ${lineUserId}`);
      // 既に利用申請を出している人には「現在申請中です」を出せるよう、pending 申請を1件だけ返す。
      // 等値2条件なので複合インデックスは不要。読めなくてもログインは止めない（表示用の付加情報）。
      const pendingRequest = await fetchPendingAccessRequest(db, lineUserId);
      return NextResponse.json({
        success: false,
        needsLinking: true,
        lineUserId,
        displayName,
        pictureUrl,
        ...(pendingRequest ? { pendingRequest } : {}),
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
