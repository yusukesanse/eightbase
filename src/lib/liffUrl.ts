/**
 * LINEミニアプリ(LIFF)として開くURLを生成する共通ヘルパー（サーバー側）。
 *
 * 通常URL（外部ブラウザで開く）ではなく LIFF URL（`liff.line.me/{liffId}/...`）にすることで、
 * 「LINEミニアプリの中で開く／戻す」を実現する。用途:
 *   - Messaging API の通知ボタン（マイ予約 / コンテンツ公開 / 掲示板 / CS）
 *   - Square 決済後のリダイレクト先（決済を終えてミニアプリに戻す）
 *
 * LIFF ID は環境ごとの値を使う（本番=prod / demo=demo。各Vercelプロジェクトが自環境の
 * LIFF IDを設定している）。万一 LIFF ID 未設定のときだけ PORTAL_URL の通常URLへフォールバック
 * してリンク自体は壊さない。
 *
 * ⚠️ 通知ボタンや決済リダイレクトに PORTAL_URL を直接入れず、必ずこの helper を経由すること
 *    （ブラウザで開いてしまうミスの再発防止）。
 */
export function liffUrl(path: string): string {
  const liffId =
    process.env.NEXT_PUBLIC_LIFF_ID_PROD ||
    process.env.NEXT_PUBLIC_LIFF_ID ||
    process.env.NEXT_PUBLIC_LIFF_ID_REVIEW ||
    "";
  const portal = process.env.NEXT_PUBLIC_PORTAL_URL || "";
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (!liffId) return `${portal}${clean}`;
  return `https://liff.line.me/${liffId}${clean}`;
}
