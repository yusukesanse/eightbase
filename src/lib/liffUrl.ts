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
 * ⚠️ LIFF は**本番のみ使用**（開発環境は Dev ログインで LINE 非連携）。本番は
 *    `NEXT_PUBLIC_LIFF_ID_PROD`（無ければ `NEXT_PUBLIC_LIFF_ID`）を使う。LIFF ID が無ければ
 *    PORTAL_URL の通常URLにフォールバックしてリンクは壊さない。
 */
export function liffUrl(path: string): string {
  const liffId =
    (getAppEnv() === "production" ? process.env.NEXT_PUBLIC_LIFF_ID_PROD : undefined) ||
    process.env.NEXT_PUBLIC_LIFF_ID_PROD ||
    process.env.NEXT_PUBLIC_LIFF_ID ||
    "";
  const portal = process.env.NEXT_PUBLIC_PORTAL_URL || "";
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (!liffId) return `${portal}${clean}`;
  return `https://liff.line.me/${liffId}${clean}`;
}
