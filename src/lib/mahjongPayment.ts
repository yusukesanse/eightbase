/**
 * 麻雀参加費（3,000円）決済のクライアント側ヘルパー。
 * `/games/mahjong`（EntryScoreTab）と `/info`（MahjongLeagueView/JoinTab）で共用し、
 * fetch とエラーハンドリングを一本化する（両UIは手動で同期運用のため）。
 * サーバー側の実体は /api/mahjong/entries/{pay,complete,cancel-payment}。
 */

export type StartPayResult =
  | { ok: true; paymentUrl: string }
  | { ok: false; message: string };

/** 参加費の決済リンクを発行。成功時は Square 決済URLへ遷移させる。 */
export async function startEntryPayment(eventDate: string): Promise<StartPayResult> {
  try {
    const res = await fetch("/api/mahjong/entries/pay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ eventDate }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.paymentUrl) return { ok: true, paymentUrl: data.paymentUrl };
    return { ok: false, message: data.message || data.error || "決済の開始に失敗しました" };
  } catch {
    return { ok: false, message: "通信に失敗しました" };
  }
}

/** 決済後リダイレクト（?mjpay=エントリーID）からの確定。 */
export async function completeEntryPayment(
  rid: string
): Promise<{ ok: boolean; message?: string; alreadyDone?: boolean }> {
  try {
    const res = await fetch("/api/mahjong/entries/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ rid }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.paid) return { ok: true, alreadyDone: !!data.alreadyDone };
    return { ok: false, message: data.message || data.error || "決済の確認に失敗しました" };
  } catch {
    return { ok: false, message: "通信に失敗しました" };
  }
}

/** 支払い済み参加費のキャンセル依頼（自動返金なし・管理者へ手動返金通知）。 */
export async function cancelEntryPayment(
  eventDate: string
): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch("/api/mahjong/entries/cancel-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ eventDate }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true };
    return { ok: false, message: data.message || data.error || "キャンセルに失敗しました" };
  } catch {
    return { ok: false, message: "通信に失敗しました" };
  }
}
