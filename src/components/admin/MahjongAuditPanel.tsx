"use client";

import { useCallback, useEffect, useState } from "react";

interface AuditLog {
  id: string;
  eventType: string;
  actor: string;
  target?: { date?: string; entryId?: string; tableId?: string };
  beforeStatus?: string | null;
  afterStatus?: string | null;
  meta?: Record<string, unknown>;
  createdAt: string;
}

const LABEL: Record<string, { text: string; color: string }> = {
  "payment.cancelRequested": { text: "キャンセル依頼", color: "#a1502c" },
  "refund.refunded": { text: "返金", color: "#2f7d57" },
  "refund.rejected": { text: "却下", color: "#5f6266" },
  "schedule.closed": { text: "休催化", color: "#c0563c" },
  "schedule.reopened": { text: "休催解除", color: "#1172a5" },
  "table.completed": { text: "卓確定", color: "#40434a" },
  "day.advanced": { text: "進行(抜け番)", color: "#1172a5" },
};

const fmt = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const targetText = (t?: AuditLog["target"]) =>
  [t?.date && `日:${t.date}`, t?.entryId && `entry:${t.entryId}`, t?.tableId && `卓:${t.tableId}`].filter(Boolean).join(" / ") || "-";

export default function MahjongAuditPanel() {
  const [items, setItems] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  const load = useCallback(
    () =>
      fetch(`/api/admin/mahjong/audit-logs${filter ? `?eventType=${filter}` : ""}`, { credentials: "same-origin" })
        .then((r) => r.json())
        .then((d) => setItems(d.items ?? []))
        .catch(() => {})
        .finally(() => setLoading(false)),
    [filter]
  );
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="p-5 max-w-4xl">
      <h1 className="text-lg font-bold text-[#231714] mb-1">麻雀 監査ログ</h1>
      <p className="text-sm text-[#231714]/60 mb-4">
        返金・キャンセル・休催化・進行確定・卓確定の操作履歴（新しい順）。卓確定に <b>⚠️</b> は自己申告の異常検知フラグです。
      </p>

      <div className="flex items-center gap-2 mb-3">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="text-sm border border-[#231714]/15 rounded-lg px-2 py-1.5 bg-white"
        >
          <option value="">すべての種別</option>
          {Object.entries(LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v.text}
            </option>
          ))}
        </select>
        <span className="text-xs text-[#231714]/40">{items.length} 件</span>
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-[#231714]/40">読み込み中…</div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#231714]/10 p-8 text-center text-sm text-[#231714]/40">
          監査ログはありません
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm bg-white rounded-xl border border-[#231714]/10">
            <thead>
              <tr className="text-left text-[11px] text-[#231714]/50 border-b border-[#231714]/10">
                <th className="px-3 py-2">時刻</th>
                <th className="px-3 py-2">種別</th>
                <th className="px-3 py-2">実行者</th>
                <th className="px-3 py-2">対象</th>
                <th className="px-3 py-2">遷移</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const l = LABEL[it.eventType] ?? { text: it.eventType, color: "#5f6266" };
                const flagged = it.meta?.flagged === true;
                return (
                  <tr key={it.id} className="border-b border-[#231714]/5 last:border-0">
                    <td className="px-3 py-2 text-[11px] text-[#231714]/60 tabular-nums whitespace-nowrap">{fmt(it.createdAt)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="text-[11px] font-black" style={{ color: l.color }}>{l.text}</span>
                      {flagged && <span title={String(it.meta?.reason ?? "")}> ⚠️</span>}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-[#231714]/70 max-w-[160px] truncate">{it.actor}</td>
                    <td className="px-3 py-2 text-[11px] text-[#231714]/60">{targetText(it.target)}</td>
                    <td className="px-3 py-2 text-[11px] text-[#231714]/60">
                      {it.beforeStatus || it.afterStatus ? `${it.beforeStatus ?? "-"} → ${it.afterStatus ?? "-"}` : "-"}
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
