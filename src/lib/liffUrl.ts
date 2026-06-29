import { getAppEnv } from "./env";

/**
 * LINEミニアプリ(LIFF)として開くURLを生成する共通ヘルパー（サーバー側）。
 *
 * 通常URL（外部ブラウザで開く）ではなく LIFF URL（`liff.line.me/{liffId}/...`）にすることで、
 * 「LINEミニアプリの中で開く／戻す」を実現する。用途:
 *   - Messaging API の通知ボタン（マイ予約 / コンテンツ公開 / 掲示板 / CS）
 *   - Square 決済後のリダイレクト先（決済を終えてミニアプリに戻す）
 *   - ゲスト招待のワンタイムURL（/guest?code=）
 *
 * ⚠️ LIFF ID は **クライアントの detectEnv(liff.ts) と一致** させる必要がある（URLのLIFF IDと
 *    liff.init のLIFF IDが食い違うと LIFF 初期化に失敗するため）。クライアントは host で判定する:
 *      本番ドメイン→prod / *.vercel.app→review / localhost→dev
 *    サーバー側は同等の対応を APP_ENV で行う:
 *      production→_PROD / demo(=*.vercel.app=review)→_REVIEW / local→base(_DEV)
 *    対応する値が無ければ安全なフォールバック、最後は PORTAL_URL の通常URLにしてリンクは壊さない。
 */
export function liffUrl(path: string): string {
  const appEnv = getAppEnv();
  const byEnv =
    appEnv === "production"
      ? process.env.NEXT_PUBLIC_LIFF_ID_PROD
      : appEnv === "demo"
        ? process.env.NEXT_PUBLIC_LIFF_ID_REVIEW
        : process.env.NEXT_PUBLIC_LIFF_ID;
  const liffId =
    byEnv ||
    process.env.NEXT_PUBLIC_LIFF_ID_PROD ||
    process.env.NEXT_PUBLIC_LIFF_ID ||
    process.env.NEXT_PUBLIC_LIFF_ID_REVIEW ||
    "";
  const portal = process.env.NEXT_PUBLIC_PORTAL_URL || "";
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (!liffId) return `${portal}${clean}`;
  return `https://liff.line.me/${liffId}${clean}`;
}
