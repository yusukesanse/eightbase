/**
 * ダーツ参加費決済のクライアントヘルパー（麻雀 mahjongPayment を流用）。
 * pay: 決済リンク発行 → 遷移 / complete: 戻り(?dartspay=)後の確定 / cancel: キャンセル依頼。
 */

/** 決済リンクを発行して URL を得る（呼び出し側で location.href 遷移）。 */
export async function startDartsEntryPayment(eventDate: string): Promise<{ entryId: string; paymentUrl: string }> {
  const res = await fetch("/api/darts/entries/pay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ eventDate }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || data.error || "決済準備に失敗しました"), { data });
  return data;
}

/** 決済後リダイレクト（/info?dartspay=rid）からの確定。 */
export async function completeDartsEntryPayment(rid: string): Promise<{ paid: boolean; alreadyDone?: boolean }> {
  const res = await fetch("/api/darts/entries/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ rid }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || data.error || "決済確定に失敗しました"), { data });
  return data;
}

/** 支払い済み参加費のキャンセル依頼（手動返金）。 */
export async function cancelDartsEntryPayment(eventDate: string): Promise<{ success: boolean }> {
  const res = await fetch("/api/darts/entries/cancel-payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ eventDate }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || data.error || "キャンセルに失敗しました"), { data });
  return data;
}
