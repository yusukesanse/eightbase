"use client";

import { useCallback, useEffect, useState } from "react";

interface RefundItem {
  entryId: string;
  eventDate: string;
  displayName: string;
  amount: number;
  state: "pending" | "refunded" | "rejected";
  cancelRequestedAt: string | null;
  refundProcessedAt: string | null;
  refundProcessedBy: string | null;
}

const STATE_LABEL: Record<RefundItem["state"], { text: string; color: string; bg: string }> = {
  pending: { text: "未対応", color: "#a1502c", bg: "#fff4ec" },
  refunded: { text: "返金済", color: "#2f7d57", bg: "#eef6f0" },
  rejected: { text: "却下", color: "#5f6266", bg: "#f1f3f4" },
};

// ISO → "MM/DD HH:mm"（JST表示）。null は "-"。
const fmt = (iso: string | null) => {
  if (!iso) return "-";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function MahjongRefundsAdminPage() {
  const [items, setItems] = useState<RefundItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingOnly, setPendingOnly] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    () =>
      fetch("/api/admin/mahjong/refunds", { credentials: "same-origin" })
        .then((r) => r.json())
        .then((d) => setItems(d.items ?? []))
        .catch(() => {})
        .finally(() => setLoading(false)),
    []
  );
  useEffect(() => {
    load();
  }, [load]);

  async function act(entryId: string, action: "refund" | "reject") {
    if (busy) return;
    setBusy(entryId);
    await fetch("/api/admin/mahjong/refund", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ entryId, action }),
    }).catch(() => {});
    await load();
    setBusy(null);
  }

  const rows = pendingOnly ? items.filter((i) => i.state === "pending") : items;
  const pendingCount = items.filter((i) => i.state === "pending").length;

  return (
    <div className="p-5 max-w-3xl">
      <h1 className="text-lg font-bold text-[#231714] mb-1">麻雀 返金対応</h1>
      <p className="text-sm text-[#231714]/60 mb-4">
        キャンセル依頼（未対応）を Square で手動返金したら「返金済」に、応じない場合は「却下」にします。
        操作は監査ログに記録されます。未対応 <b>{pendingCount}</b> 件。
      </p>

      <label className="inline-flex items-center gap-2 mb-3 text-sm text-[#231714]/70">
        <input type="checkbox" checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)} />
        未対応のみ表示
      </label>

      {loading ? (
        <div className="py-10 text-center text-sm text-[#231714]/40">読み込み中…</div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#231714]/10 p-8 text-center text-sm text-[#231714]/40">
          {pendingOnly ? "未対応の返金依頼はありません" : "返金対象はありません"}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm bg-white rounded-xl border border-[#231714]/10">
            <thead>
              <tr className="text-left text-[11px] text-[#231714]/50 border-b border-[#231714]/10">
                <th className="px-3 py-2">対象日</th>
                <th className="px-3 py-2">ユーザー</th>
                <th className="px-3 py-2 text-right">金額</th>
                <th className="px-3 py-2">状態</th>
                <th className="px-3 py-2">依頼</th>
                <th className="px-3 py-2">処理</th>
                <th className="px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((it) => {
                const s = STATE_LABEL[it.state];
                return (
                  <tr key={it.entryId} className="border-b border-[#231714]/5 last:border-0">
                    <td className="px-3 py-2 tabular-nums">{it.eventDate}</td>
                    <td className="px-3 py-2 font-bold text-[#1c1f21]">{it.displayName}</td>
                    <td className="px-3 py-2 text-right tabular-nums">¥{it.amount.toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <span className="text-[11px] font-black px-1.5 py-0.5 rounded" style={{ color: s.color, background: s.bg }}>
                        {s.text}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-[#231714]/60 tabular-nums">{fmt(it.cancelRequestedAt)}</td>
                    <td className="px-3 py-2 text-[11px] text-[#231714]/60 tabular-nums">
                      {fmt(it.refundProcessedAt)}
                      {it.refundProcessedBy && <div className="text-[10px] text-[#231714]/40">{it.refundProcessedBy}</div>}
                    </td>
                    <td className="px-3 py-2">
                      {it.state === "pending" ? (
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => act(it.entryId, "refund")}
                            disabled={busy === it.entryId}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-extrabold text-white disabled:opacity-50"
                            style={{ background: "#2f7d57" }}
                          >
                            返金済
                          </button>
                          <button
                            onClick={() => act(it.entryId, "reject")}
                            disabled={busy === it.entryId}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-[#5f6266] bg-[#f1f3f4] disabled:opacity-50"
                          >
                            却下
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-[#231714]/30">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
