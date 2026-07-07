"use client";

import { useCallback, useEffect, useState } from "react";

interface AdminNotification {
  id: string;
  type: string;
  message: string;
  data?: { reservationId?: string; facilityId?: string; orderId?: string };
  read?: boolean;
  createdAt?: string;
}

const TYPE_LABEL: Record<string, { label: string; color: string }> = {
  switchbot_failed: { label: "解錠コード発行失敗", color: "#d8533a" },
  switchbot_manual: { label: "手動解錠対応", color: "#d8533a" },
  trailer_cancel: { label: "取消・返金対応", color: "#b48f13" },
  mahjong_refund: { label: "返金対応", color: "#b48f13" },
  access_request: { label: "利用申請", color: "#2f7d57" },
};

function fmt(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function AdminNotificationsPage() {
  const [items, setItems] = useState<AdminNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reissued, setReissued] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/notifications", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => setItems(d.notifications ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function markRead(id: string) {
    await fetch("/api/admin/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ id }),
    });
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }

  async function markAllRead() {
    await fetch("/api/admin/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ markAllRead: true }),
    });
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  async function reissue(n: AdminNotification) {
    const reservationId = n.data?.reservationId;
    if (!reservationId) return;
    setBusyId(n.id);
    try {
      const res = await fetch(`/api/admin/reservations/${reservationId}/reissue`, {
        method: "POST",
        credentials: "same-origin",
      });
      const d = await res.json();
      if (res.ok && d.passcode) {
        setReissued((prev) => ({ ...prev, [n.id]: d.passcode }));
        await markRead(n.id);
      } else {
        alert(d.message || d.error || "再発行に失敗しました");
      }
    } catch {
      alert("通信エラーが発生しました");
    } finally {
      setBusyId(null);
    }
  }

  const unread = items.filter((n) => !n.read).length;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-[#1a1a2e]">
          通知{unread > 0 && <span className="ml-2 text-sm text-red-500">未読 {unread}</span>}
        </h1>
        {unread > 0 && (
          <button
            onClick={markAllRead}
            className="text-xs text-gray-500 border border-gray-200 rounded-lg px-3 py-1.5"
          >
            すべて既読
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-sm text-gray-400">読み込み中...</div>
      ) : items.length === 0 ? (
        <div className="bg-gray-50 rounded-xl px-4 py-8 text-center text-sm text-gray-400">
          通知はありません
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((n) => {
            const meta = TYPE_LABEL[n.type] ?? { label: n.type, color: "#6b7280" };
            return (
              <div
                key={n.id}
                className={`rounded-xl border p-3 ${n.read ? "bg-white border-gray-100 opacity-70" : "bg-white border-gray-200"}`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white"
                    style={{ background: meta.color }}
                  >
                    {meta.label}
                  </span>
                  {!n.read && <span className="w-2 h-2 rounded-full bg-red-500" />}
                  <span className="flex-1" />
                  <span className="text-[11px] text-gray-400">{fmt(n.createdAt)}</span>
                </div>
                <p className="text-sm text-gray-700 mt-1.5 leading-relaxed">{n.message}</p>

                {reissued[n.id] && (
                  <div className="mt-2 rounded-lg bg-[#2f7d57]/5 border border-[#2f7d57]/30 px-3 py-2 text-center">
                    <span className="text-[11px] text-[#2f7d57] font-bold">再発行コード: </span>
                    <span className="text-base font-black tabular-nums tracking-widest">{reissued[n.id]}</span>
                  </div>
                )}

                <div className="flex items-center gap-2 mt-2">
                  {n.type === "switchbot_failed" && n.data?.reservationId && !reissued[n.id] && (
                    <button
                      onClick={() => reissue(n)}
                      disabled={busyId === n.id}
                      className="text-[11px] text-white bg-[#2f7d57] rounded-lg px-3 py-1.5 disabled:opacity-50"
                    >
                      {busyId === n.id ? "発行中..." : "解錠コードを再発行"}
                    </button>
                  )}
                  {!n.read && (
                    <button
                      onClick={() => markRead(n.id)}
                      className="text-[11px] text-gray-500 border border-gray-200 rounded-lg px-3 py-1.5"
                    >
                      既読にする
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
