/**
 * ポーカー参加費決済のクライアントヘルパー（ダーツ/ビリヤード payment を流用）。
 * pay: 決済リンク発行 → 遷移 / complete: 戻り(?pokerpay=)後の確定 / cancel: キャンセル依頼。
 */

export async function startPokerEntryPayment(eventDate: string): Promise<{ entryId: string; paymentUrl: string }> {
  const res = await fetch("/api/poker/entries/pay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ eventDate }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || data.error || "決済準備に失敗しました"), { data });
  return data;
}

export async function completePokerEntryPayment(rid: string): Promise<{ paid: boolean; alreadyDone?: boolean }> {
  const res = await fetch("/api/poker/entries/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ rid }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || data.error || "決済確定に失敗しました"), { data });
  return data;
}

export async function cancelPokerEntryPayment(eventDate: string): Promise<{ success: boolean }> {
  const res = await fetch("/api/poker/entries/cancel-payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ eventDate }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || data.error || "キャンセルに失敗しました"), { data });
  return data;
}
