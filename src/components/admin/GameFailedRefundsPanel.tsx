"use client";

import { useCallback, useEffect, useState } from "react";

import type { FailedAutoRefund as Item } from "@/lib/gameEntryPayment";

type GameCategory = "mahjong" | "darts" | "billiards" | "poker";

const fmt = (iso: string | null) => {
  if (!iso) return "-";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function GameFailedRefundsPanel({ gameCategory }: { gameCategory: GameCategory }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(
    () =>
      fetch(`/api/admin/games/refund-sync?game=${gameCategory}`, { credentials: "same-origin" })
        .then(async (r) => {
          const data = await r.json();
          if (!r.ok) throw new Error(data.message ?? data.error ?? "取得に失敗しました");
          return data;
        })
        .then((d) => setItems(d.items ?? []))
        .catch((error) => setMessage({ ok: false, text: error instanceof Error ? error.message : "取得に失敗しました" }))
        .finally(() => setLoading(false)),
    [gameCategory]
  );
  useEffect(() => { load(); }, [load]);

  async function syncRefund(item: Item) {
    if (busy) return;
    if (!confirm(
      `${item.displayName} さんの参加費 ¥${item.amount.toLocaleString()} が Square で全額返金されているか確認し、返金済みとして記録します。`
    )) return;

    setBusy(item.entryId);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/games/refund-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ game: gameCategory, entryId: item.entryId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ ok: false, text: data.error === "REFUND_NOT_FOUND"
          ? "Squareで全額返金が確認できません。まだ返金されていないか、一部返金の可能性があります。"
          : data.message ?? data.error ?? "返金を記録できませんでした" });
      } else {
        setMessage({
          ok: true,
          text: data.already
            ? `${item.displayName} さんは既に返金済みでした。`
            : `${item.displayName} さんの返金を記録しました。`,
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
      <h1 className="text-lg font-bold text-[#231714] mb-1">自動返金に失敗したもの</h1>
      <p className="text-sm text-[#231714]/80 mb-4">
        参加者本人によるキャンセルの自動返金が、Square側の一時的な失敗や記録の反映失敗で完了しなかったものです。
        Squareの管理画面で返金済みであることを確認できたら記録できます（このアプリからは返金の実行はしません）。
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
                <th className="py-2 pr-3 font-medium">失敗日時</th>
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
                    {fmt(it.failedAt)}
                  </td>
                  <td className="py-2.5 pr-3 text-[11px] text-[#231714]/60 font-mono">{it.orderId ?? "-"}</td>
                  <td className="py-2.5 text-right whitespace-nowrap">
                    <button
                      onClick={() => syncRefund(it)}
                      disabled={busy !== null}
                      className="px-3 py-1.5 text-xs font-bold text-white bg-[#2f7d57] rounded-lg hover:bg-[#2f7d57]/85 disabled:opacity-50"
                    >
                      {busy === it.entryId ? "照合中…" : "Square で返金を確認して記録"}
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
