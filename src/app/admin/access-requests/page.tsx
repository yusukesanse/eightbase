"use client";

import { useCallback, useEffect, useState } from "react";

interface AccessRequestItem {
  id: string;
  lineUserId: string;
  lineDisplayName?: string;
  displayName: string;
  email: string;
  companyName: string;
  requestedRole: "member" | "guest";
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

// 自己申告できるのは member / guest のみ（staffはURL招待の別導線）。
type RoleOption = "member" | "guest";
const ROLE_LABEL: Record<string, { label: string; color: string }> = {
  member: { label: "オフィス契約者", color: "#1172a5" },
  guest: { label: "ゲスト", color: "#b48f13" },
  staff: { label: "エイトデザイン社員", color: "#a2125a" },
};
const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending: { label: "承認待ち", color: "#b48f13" },
  approved: { label: "承認済み", color: "#2f7d57" },
  rejected: { label: "却下", color: "#8a8f94" },
};

function fmt(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function AdminAccessRequestsPage() {
  const [items, setItems] = useState<AccessRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [roleById, setRoleById] = useState<Record<string, RoleOption>>({});
  const [note, setNote] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/access-requests`, { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => setItems(d.requests ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (id: string) => {
    setBusyId(id);
    try {
      const role = roleById[id] ?? items.find((i) => i.id === id)?.requestedRole ?? "member";
      const res = await fetch(`/api/admin/access-requests/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "approve", role }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNote((p) => ({ ...p, [id]: d?.error || "承認に失敗しました" }));
      } else {
        setNote((p) => ({
          ...p,
          [id]: d.emailSent
            ? "承認しOTPメールを送信しました"
            : d.passcode
              ? `承認（メール送信失敗）。手動共有コード: ${d.passcode}`
              : "承認しました",
        }));
        load();
      }
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/access-requests/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "reject" }),
      });
      if (res.ok) load();
      else {
        const d = await res.json().catch(() => ({}));
        setNote((p) => ({ ...p, [id]: d?.error || "却下に失敗しました" }));
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-5 md:p-8 max-w-3xl">
      <div className="mb-5">
        <h1 className="text-lg font-bold text-[#1c1f21]">利用申請</h1>
        <p className="text-xs text-[#8a8f94] mt-0.5">
          利用者からの申請を承認するとOTPメールが届き、本登録に進めます。
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-[#8a8f94]">読み込み中...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-[#8a8f94]">申請はありません。</p>
      ) : (
        <div className="space-y-3">
          {items.map((it) => {
            const st = STATUS_LABEL[it.status] ?? STATUS_LABEL.pending;
            const typ = ROLE_LABEL[it.requestedRole] ?? ROLE_LABEL.member;
            const isPending = it.status === "pending";
            const role = roleById[it.id] ?? it.requestedRole;
            return (
              <div key={it.id} className="rounded-2xl border border-gray-100 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-[#1c1f21]">{it.displayName}</span>
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                        style={{ color: typ.color, background: `${typ.color}18` }}
                      >
                        {typ.label}
                      </span>
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                        style={{ color: st.color, background: `${st.color}18` }}
                      >
                        {st.label}
                      </span>
                    </div>
                    <div className="text-xs text-[#231714]/70 mt-1">{it.companyName}</div>
                    <div className="text-xs text-[#231714]/50">{it.email}</div>
                    <div className="text-[11px] text-[#8a8f94] mt-1">
                      LINE名: {it.lineDisplayName || "—"}　/　{fmt(it.createdAt)}
                    </div>
                  </div>
                </div>

                {isPending && (
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    <select
                      value={role}
                      onChange={(e) => setRoleById((p) => ({ ...p, [it.id]: e.target.value as RoleOption }))}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-2"
                    >
                      {(["member", "guest"] as RoleOption[]).map((r) => (
                        <option key={r} value={r}>{ROLE_LABEL[r].label}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => approve(it.id)}
                      disabled={busyId === it.id}
                      className="text-xs font-bold text-white bg-[#2f7d57] rounded-lg px-3.5 py-2 disabled:opacity-50"
                    >
                      {busyId === it.id ? "処理中..." : "追加（承認）"}
                    </button>
                    <button
                      onClick={() => reject(it.id)}
                      disabled={busyId === it.id}
                      className="text-xs font-bold text-[#8a8f94] border border-gray-200 rounded-lg px-3 py-2 disabled:opacity-50"
                    >
                      却下
                    </button>
                  </div>
                )}

                {note[it.id] && <p className="text-[11px] text-[#2f7d57] mt-2">{note[it.id]}</p>}
                {!isPending && it.reviewedBy && (
                  <p className="text-[11px] text-[#8a8f94] mt-2">
                    {fmt(it.reviewedAt)} ・ {it.reviewedBy}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
