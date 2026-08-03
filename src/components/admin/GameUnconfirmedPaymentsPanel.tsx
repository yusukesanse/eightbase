"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * 参加費の「入金確認待ち」対応（4種目共通・全シーズン横断）。
 *
 * 決済リンクは発行済みなのに未払いのまま残っているエントリーを出し、
 * Square の入金を照合したうえで「支払い済み」に戻す。
 * 2026-08-03 の障害（決済の戻り先が会員専用ルートで、ゲストだけ確定処理に到達できず
 * 課金済みなのに未払いになった）の復旧用。通常運用でも取りこぼしの受け皿になる。
 *
 * ⚠️ 入金照合はサーバー側で必ず行う。ここのボタンは「照合して良い」という指示でしかなく、
 *    未払いを支払い済みにする権限ではない（Square が未入金なら 402 で弾かれる）。
 */

interface Item {
  entryId: string;
  eventDate: string;
  displayName: string;
  lineUserId: string;
  amount: number;
  orderId: string;
  pendingExpiresAt: string | null;
  expired: boolean;
  createdAt: string | null;
}

type GameCategory = "mahjong" | "darts" | "billiards" | "poker";

const fmt = (iso: string | null) => {
  if (!iso) return "-";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function GameUnconfirmedPaymentsPanel({ gameCategory }: { gameCategory: GameCategory }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(
    () =>
      fetch(`/api/admin/games/payments?game=${gameCategory}`, { credentials: "same-origin" })
        .then((r) => r.json())
        .then((d) => setItems(d.items ?? []))
        .catch(() => {})
        .finally(() => setLoading(false)),
    [gameCategory]
  );
  useEffect(() => { load(); }, [load]);

  async function markPaid(item: Item) {
    if (busy) return;
    if (!confirm(
      `${item.displayName} さんの参加費を「支払い済み」にします。\n` +
      `（開催日 ${item.eventDate} / ¥${item.amount.toLocaleString()}）\n\n` +
      `Square の入金を照合し、確認できた場合のみ確定します。`
    )) return;

    setBusy(item.entryId);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/games/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ game: gameCategory, entryId: item.entryId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ ok: false, text: data.error ?? "支払い済みにできませんでした" });
      } else {
        setMessage({
          ok: true,
          text: data.alreadyPaid
            ? `${item.displayName} さんは既に支払い済みでした。`
            : `${item.displayName} さんを支払い済みにしました。当日の名簿にも反映されます。`,
        });
      }
      await load();
    } catch {
      setMessage({ ok: false, text: "通信に失敗しました" });
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return <div className="p-5 flex justify-center"><div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <section className="p-5 pb-0 max-w-3xl">
      <h1 className="text-lg font-bold text-[#231714] mb-1">入金確認待ち</h1>
      <p className="text-sm text-[#231714]/80 mb-4">
        決済リンクは発行済みなのに未払いのまま残っているエントリーです。
        Square の入金を照合したうえで「支払い済み」に戻せます（未入金なら確定されません）。
      </p>

      {message && (
        <div className={`mb-3 rounded-xl px-4 py-3 text-sm font-bold border ${
          message.ok
            ? "bg-[#eef6f0] border-[#cfe6d8] text-[#2f7d57]"
            : "bg-[#fdece8] border-[#f4c9bd] text-[#d8533a]"
        }`}>
          {message.text}
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-[#231714]/70 py-4">対象はありません。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[#231714]/70 border-b border-[#231714]/10">
                <th className="py-2 pr-3 font-medium">開催日</th>
                <th className="py-2 pr-3 font-medium">氏名</th>
                <th className="py-2 pr-3 font-medium">金額</th>
                <th className="py-2 pr-3 font-medium">受付期限</th>
                <th className="py-2 pr-3 font-medium">注文ID</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.entryId} className="border-b border-[#231714]/[0.06]">
                  <td className="py-2.5 pr-3 whitespace-nowrap">{it.eventDate}</td>
                  <td className="py-2.5 pr-3">{it.displayName || "-"}</td>
                  <td className="py-2.5 pr-3 whitespace-nowrap">¥{it.amount.toLocaleString()}</td>
                  <td className="py-2.5 pr-3 whitespace-nowrap">
                    {fmt(it.pendingExpiresAt)}
                    {it.expired && (
                      <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-[#fff4ec] text-[#a1502c]">
                        期限切れ
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-[11px] text-[#231714]/60 font-mono">{it.orderId.slice(0, 12)}…</td>
                  <td className="py-2.5 text-right whitespace-nowrap">
                    <button
                      onClick={() => markPaid(it)}
                      disabled={busy === it.entryId}
                      className="px-3 py-1.5 text-xs font-bold text-white bg-[#2f7d57] rounded-lg hover:bg-[#2f7d57]/85 disabled:opacity-50"
                    >
                      {busy === it.entryId ? "照合中…" : "入金を確認して支払い済みに"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
