/**
 * LINE 審査モード判定。
 *
 * 審査（review）時のみ、未登録の LINE ユーザーでもアプリを閲覧できるようにする抜け穴。
 * 本番では事故防止のため二重ガードする:
 *   1. NODE_ENV !== "production"（= 開発/プレビュー）であること、または
 *      環境変数 ALLOW_REVIEW_MODE === "true" で明示的に許可されていること。
 *   2. かつ Firestore `settings/app.reviewMode === true`。
 *
 * `/api/auth/liff-login` と `/api/auth/check` の双方で同じ判定を行うため共通化する。
 */

import type { Firestore } from "firebase-admin/firestore";

/** 環境変数ガード: そもそも審査モードを許可してよい環境か */
function reviewModeAllowedByEnv(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.ALLOW_REVIEW_MODE === "true"
  );
}

/**
 * 現在のリクエストで審査モードが有効かを返す。
 * 環境ガードを満たさない場合は Firestore を読まずに false。
 */
export async function isReviewModeEnabled(db: Firestore): Promise<boolean> {
  if (!reviewModeAllowedByEnv()) return false;
  try {
    const settingsDoc = await db.collection("settings").doc("app").get();
    return settingsDoc.exists && settingsDoc.data()?.reviewMode === true;
  } catch (e) {
    console.warn("[reviewMode] settings fetch error:", e);
    return false;
  }
}
