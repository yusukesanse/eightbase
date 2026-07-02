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

import { isDevLoginEnabled } from "./env";
import { isDevToken, parseDevToken } from "./devLogin";

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
 * - "invalid": verify エンドポイントが失敗、client_id 不一致、または通信エラー
 */
export type LineTokenStatus = "valid" | "expired" | "invalid";

/**
 * このアプリが想定する LINE Login/LIFF チャネルID（= verify レスポンスの client_id）を返す。
 *
 * - 明示指定 `LINE_LOGIN_CHANNEL_ID`（カンマ区切りで複数可）があれば最優先。
 * - 無ければ各環境の LIFF ID（`NEXT_PUBLIC_LIFF_ID(_REVIEW/_PROD)`）の
 *   ハイフン前プレフィックス（= チャネルID）から導出する。
 *   ※ LIFF ID は `{channelId}-{suffix}` 形式で、prefix が発行元チャネルIDに一致する。
 *
 * どれも設定されていない場合は空集合を返し、呼び出し側は client_id 検証をスキップする
 * （env 未設定の開発環境で誤ってログイン不能にしないための fail-open。警告は出す）。
 */
export function getExpectedLineChannelIds(): Set<string> {
  const ids = new Set<string>();

  const explicit = process.env.LINE_LOGIN_CHANNEL_ID ?? "";
  for (const raw of explicit.split(",")) {
    const v = raw.trim();
    if (v) ids.add(v);
  }
  if (ids.size > 0) return ids;

  for (const liffId of [
    process.env.NEXT_PUBLIC_LIFF_ID,
    process.env.NEXT_PUBLIC_LIFF_ID_REVIEW,
    process.env.NEXT_PUBLIC_LIFF_ID_PROD,
  ]) {
    const prefix = (liffId ?? "").split("-")[0].trim();
    if (prefix) ids.add(prefix);
  }
  return ids;
}

/**
 * LINE OAuth の verify エンドポイントでアクセストークンを検証する。
 * 有効期限に加え、**トークンの発行元チャネル（client_id）が当アプリの想定チャネルと
 * 一致するか**も検証する（他チャネルで発行されたトークンでの成りすまし・不正ログイン防止）。
 * 例外（通信エラー等）は握りつぶして "invalid" を返す。
 */
export async function verifyLineAccessToken(
  accessToken: string
): Promise<LineTokenStatus> {
  // Dev ログイン（非本番のみ）: 合成トークンは LINE を呼ばず、内容が妥当なら有効扱い。
  if (isDevLoginEnabled() && isDevToken(accessToken)) {
    return parseDevToken(accessToken) ? "valid" : "invalid";
  }
  try {
    const res = await fetch(
      `https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`
    );
    if (!res.ok) {
      console.warn("[lineAuth] token verify failed:", await res.text());
      return "invalid";
    }
    const data = await res.json();
    if (!(data.expires_in > 0)) return "expired";

    // client_id（発行元チャネル）が想定チャネルと一致するか検証
    const expected = getExpectedLineChannelIds();
    if (expected.size === 0) {
      console.warn(
        "[lineAuth] 想定チャネルID未設定のため client_id 検証をスキップします（LINE_LOGIN_CHANNEL_ID もしくは NEXT_PUBLIC_LIFF_ID を設定してください）"
      );
    } else if (!expected.has(String(data.client_id))) {
      console.warn(
        `[lineAuth] client_id mismatch: got="${data.client_id}" expected=${JSON.stringify(Array.from(expected))}`
      );
      return "invalid";
    }
    return "valid";
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
  // Dev ログイン（非本番のみ）: 合成トークンから疑似プロフィールを返す。
  if (isDevLoginEnabled() && isDevToken(accessToken)) {
    const id = parseDevToken(accessToken);
    return id
      ? { userId: id.userId, displayName: id.displayName, pictureUrl: id.pictureUrl ?? "" }
      : null;
  }
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
