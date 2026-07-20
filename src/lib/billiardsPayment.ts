/**
 * ビリヤード参加費決済のクライアントヘルパー（ダーツ dartsPayment を流用）。
 * pay: 決済リンク発行 → 遷移 / complete: 戻り(?billiardspay=)後の確定 / cancel: キャンセル依頼。
 */

export async function startBilliardsEntryPayment(eventDate: string): Promise<{ entryId: string; paymentUrl: string }> {
  const res = await fetch("/api/billiards/entries/pay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ eventDate }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || data.error || "決済準備に失敗しました"), { data });
  return data;
}

export async function completeBilliardsEntryPayment(rid: string): Promise<{ paid: boolean; alreadyDone?: boolean }> {
  const res = await fetch("/api/billiards/entries/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ rid }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || data.error || "決済確定に失敗しました"), { data });
  return data;
}

export async function cancelBilliardsEntryPayment(eventDate: string): Promise<{ success: boolean }> {
  const res = await fetch("/api/billiards/entries/cancel-payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ eventDate }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || data.error || "キャンセルに失敗しました"), { data });
  return data;
}
