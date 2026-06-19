/**
 * イベントの「good（いいね）」状態を端末ローカル(localStorage)に保持するヘルパー。
 *
 * good 状態はサーバーのカウントとは別に「自分が good したか」を端末に覚えておくための
 * 個人データ。共有端末でユーザーが切り替わったとき前ユーザーの good 表示が残らないよう、
 * ログイン/ログアウト時に clearEventGoods() で破棄する（clearAuthCache から呼ぶ）。
 */

const GOOD_KEY = "event_goods";

export function getGoodSet(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(GOOD_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

export function saveGoodSet(s: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(GOOD_KEY, JSON.stringify(Array.from(s)));
  } catch {
    // quota 超過などは無視
  }
}

/** good 状態を破棄する（ログイン/ログアウトでユーザー切替時に呼ぶ）。 */
export function clearEventGoods(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(GOOD_KEY);
  } catch {
    // 無視
  }
}
