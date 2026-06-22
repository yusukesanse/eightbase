/**
 * LINE ログイン（LIFF）アクセストークンのサーバー側検証ヘルパー。
 *
 * `/api/auth/liff-login` と `/api/auth/invite` の双方で、
 * 「アクセストークンを LINE API で検証 → プロフィール取得」という同じ手順を踏むため、
 * その2ステップをここに集約する（lineUserId をクライアントから信頼しないための要）。
 *
 * 注意: ここは LINE *Login* チャネルの OAuth/プロフィール API を叩く。
 * Messaging API（push/multicast）の実装は `src/lib/line.ts` 側にある。
 */

/** LINE プロフィール（必要な項目のみ） */
export interface LineProfile {
  userId: string;
  displayName: string;
  pictureUrl: string;
}

/**
 * アクセストークンの検証結果。
 * - "valid":   有効なトークン
 * - "expired": LINE は受理したが有効期限切れ（expires_in <= 0）
 * - "invalid": verify エンドポイントが失敗、または通信エラー
 */
export type LineTokenStatus = "valid" | "expired" | "invalid";

/**
 * LINE OAuth の verify エンドポイントでアクセストークンを検証する。
 * 例外（通信エラー等）は握りつぶして "invalid" を返す。
 */
export async function verifyLineAccessToken(
  accessToken: string
): Promise<LineTokenStatus> {
  try {
    const res = await fetch(
      `https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`
    );
    if (!res.ok) {
      console.warn("[lineAuth] token verify failed:", await res.text());
      return "invalid";
    }
    const data = await res.json();
    return data.expires_in > 0 ? "valid" : "expired";
  } catch (e) {
    console.warn("[lineAuth] token verify error:", e);
    return "invalid";
  }
}

/**
 * アクセストークンで LINE プロフィールを取得する。
 * 取得失敗・userId 欠落・通信エラーはいずれも null を返す。
 */
export async function fetchLineProfile(
  accessToken: string
): Promise<LineProfile | null> {
  try {
    const res = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      console.warn("[lineAuth] profile fetch failed:", await res.text());
      return null;
    }
    const p = await res.json();
    if (!p.userId) return null;
    return {
      userId: p.userId,
      displayName: p.displayName ?? "",
      pictureUrl: p.pictureUrl ?? "",
    };
  } catch (e) {
    console.warn("[lineAuth] profile fetch error:", e);
    return null;
  }
}
