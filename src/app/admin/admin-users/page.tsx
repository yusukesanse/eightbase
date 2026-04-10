"use client";

import { useEffect, useState, useCallback } from "react";

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
  createdBy: string;
  isSuperAdmin: boolean;
}

interface LoginLog {
  id: string;
  action: string;
  email: string;
  name: string;
  reason: string;
  ip: string;
  userAgent: string;
  timestamp: string;
}

type Tab = "admins" | "logs";

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  login_success: { label: "ログイン成功", color: "bg-green-100 text-green-800" },
  login_denied: { label: "ログイン拒否", color: "bg-red-100 text-red-800" },
  login_failed: { label: "ログイン失敗", color: "bg-orange-100 text-orange-800" },
  logout: { label: "ログアウト", color: "bg-gray-100 text-gray-800" },
};

export default function AdminUsersPage() {
  const [tab, setTab] = useState<Tab>("admins");
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [currentEmail, setCurrentEmail] = useState("");
  const [currentIsSuperAdmin, setCurrentIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 追加フォーム
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // 削除中
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ログイン履歴
  const [logs, setLogs] = useState<LoginLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsLoaded, setLogsLoaded] = useState(false);

  const fetchAdmins = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/admin-users", {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("取得に失敗しました");
      const data = await res.json();
      setAdmins(data.admins);
      setCurrentEmail(data.currentEmail);
      setCurrentIsSuperAdmin(data.currentIsSuperAdmin);
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    if (logsLoaded) return;
    setLogsLoading(true);
    try {
      const res = await fetch("/api/admin/login-logs", {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("取得に失敗しました");
      const data = await res.json();
      setLogs(data.logs);
      setLogsLoaded(true);
    } catch (err) {
      console.error("Failed to fetch logs:", err);
    } finally {
      setLogsLoading(false);
    }
  }, [logsLoaded]);

  useEffect(() => {
    fetchAdmins();
  }, [fetchAdmins]);

  useEffect(() => {
    if (tab === "logs") {
      fetchLogs();
    }
  }, [tab, fetchLogs]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    setAdding(true);

    try {
      const res = await fetch("/api/admin/admin-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: newEmail.trim(), name: newName.trim() }),
      });

      if (res.ok) {
        setNewEmail("");
        setNewName("");
        setShowAddForm(false);
        await fetchAdmins();
      } else {
        const data = await res.json().catch(() => ({}));
        setAddError(data.error || "追加に失敗しました");
      }
    } catch {
      setAddError("接続エラーが発生しました");
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(admin: AdminUser) {
    if (!confirm(`${admin.email} を管理者から削除しますか？`)) return;

    setDeletingId(admin.id);
    try {
      const res = await fetch("/api/admin/admin-users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ id: admin.id }),
      });

      if (res.ok) {
        await fetchAdmins();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "削除に失敗しました");
      }
    } catch {
      alert("接続エラーが発生しました");
    } finally {
      setDeletingId(null);
    }
  }

  function formatTimestamp(ts: string) {
    if (!ts) return "-";
    const d = new Date(ts);
    return d.toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#231714] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[#231714]">管理者設定</h1>
          <p className="text-sm text-[#231714]/60 mt-1">
            ログイン中: {currentEmail}
            {currentIsSuperAdmin && (
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                スーパー管理者
              </span>
            )}
          </p>
        </div>
        {currentIsSuperAdmin && tab === "admins" && (
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#231714] text-white text-sm font-medium rounded-lg hover:bg-[#231714]/80 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            管理者を追加
          </button>
        )}
      </div>

      {/* タブ */}
      <div className="flex gap-1 mb-5 border-b border-[#231714]/10">
        <button
          onClick={() => setTab("admins")}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === "admins"
              ? "border-gray-900 text-[#231714]"
              : "border-transparent text-[#231714]/40 hover:text-[#231714]/60"
          }`}
        >
          管理者一覧
        </button>
        <button
          onClick={() => setTab("logs")}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === "logs"
              ? "border-gray-900 text-[#231714]"
              : "border-transparent text-[#231714]/40 hover:text-[#231714]/60"
          }`}
        >
          ログイン履歴
        </button>
      </div>

      {/* ── 管理者一覧タブ ── */}
      {tab === "admins" && (
        <>
          {/* 追加フォーム */}
          {showAddForm && (
            <div className="bg-white border border-[#231714]/10 rounded-xl p-5 mb-6">
              <h2 className="text-sm font-semibold text-[#231714] mb-3">管理者を追加</h2>
              <form onSubmit={handleAdd} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-[#231714]/60 mb-1">
                    Googleメールアドレス <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="example@gmail.com"
                    required
                    className="w-full px-3 py-2.5 text-sm border border-[#231714]/10 rounded-lg focus:outline-none focus:border-[#231714] focus:ring-1 focus:ring-gray-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#231714]/60 mb-1">
                    名前（任意）
                  </label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="管理者の名前"
                    className="w-full px-3 py-2.5 text-sm border border-[#231714]/10 rounded-lg focus:outline-none focus:border-[#231714] focus:ring-1 focus:ring-gray-800"
                  />
                </div>
                {addError && (
                  <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                    <p className="text-xs text-red-600">{addError}</p>
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={adding}
                    className="px-4 py-2 bg-[#231714] text-white text-sm font-medium rounded-lg hover:bg-[#231714]/80 disabled:opacity-50 transition-colors"
                  >
                    {adding ? "追加中..." : "追加する"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowAddForm(false); setAddError(null); }}
                    className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    キャンセル
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* 管理者一覧 */}
          <div className="bg-white border border-[#231714]/10 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-[#231714]/5">
              <h2 className="text-sm font-semibold text-[#231714]">
                管理者一覧（{admins.length}名）
              </h2>
            </div>
            <div className="divide-y divide-[#231714]/5">
              {admins.map((admin) => (
                <div
                  key={admin.id}
                  className="px-5 py-4 flex items-center justify-between"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-[#231714] truncate">
                        {admin.email}
                      </p>
                      {admin.isSuperAdmin && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 shrink-0">
                          スーパー管理者
                        </span>
                      )}
                      {admin.email.toLowerCase() === currentEmail.toLowerCase() && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 shrink-0">
                          自分
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      {admin.name && (
                        <p className="text-xs text-[#231714]/60">{admin.name}</p>
                      )}
                      {admin.createdAt && (
                        <p className="text-xs text-[#231714]/40">
                          追加日: {new Date(admin.createdAt).toLocaleDateString("ja-JP")}
                        </p>
                      )}
                      {admin.createdBy && admin.createdBy !== "環境変数" && (
                        <p className="text-xs text-[#231714]/40">
                          追加者: {admin.createdBy}
                        </p>
                      )}
                    </div>
                  </div>

                  {currentIsSuperAdmin &&
                    !admin.isSuperAdmin &&
                    admin.email.toLowerCase() !== currentEmail.toLowerCase() && (
                      <button
                        onClick={() => handleDelete(admin)}
                        disabled={deletingId === admin.id}
                        className="ml-3 p-2 text-[#231714]/40 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                        title="削除"
                      >
                        {deletingId === admin.id ? (
                          <div className="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <path d="M2 4h12M5.5 4V2.5a1 1 0 011-1h3a1 1 0 011 1V4M6.5 7v4.5M9.5 7v4.5M3.5 4l.5 9a1.5 1.5 0 001.5 1.5h5A1.5 1.5 0 0012 13l.5-9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </button>
                    )}
                </div>
              ))}

              {admins.length === 0 && (
                <div className="px-5 py-8 text-center">
                  <p className="text-sm text-[#231714]/40">管理者が登録されていません</p>
                </div>
              )}
            </div>
          </div>

          {currentIsSuperAdmin && (
            <div className="mt-4 px-4 py-3 bg-gray-50 rounded-lg">
              <p className="text-xs text-[#231714]/60 leading-relaxed">
                スーパー管理者（環境変数で設定）は常にアクセス可能で、削除できません。
                ここで追加した管理者は、Googleアカウントでログインできるようになります。
              </p>
            </div>
          )}
        </>
      )}

      {/* ── ログイン履歴タブ ── */}
      {tab === "logs" && (
        <div className="bg-white border border-[#231714]/10 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-[#231714]/5">
            <h2 className="text-sm font-semibold text-[#231714]">
              ログイン履歴（最新100件）
            </h2>
          </div>

          {logsLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-[#231714] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : logs.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-[#231714]/40">ログイン履歴がありません</p>
            </div>
          ) : (
            <div className="divide-y divide-[#231714]/5">
              {logs.map((log) => {
                const actionInfo = ACTION_LABELS[log.action] || {
                  label: log.action,
                  color: "bg-gray-100 text-gray-800",
                };
                return (
                  <div key={log.id} className="px-5 py-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${actionInfo.color}`}
                      >
                        {actionInfo.label}
                      </span>
                      <span className="text-sm text-[#231714]">
                        {log.email || "(不明)"}
                      </span>
                      {log.name && (
                        <span className="text-xs text-[#231714]/40">
                          ({log.name})
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-[#231714]/40">
                      <span>{formatTimestamp(log.timestamp)}</span>
                      {log.reason && (
                        <span className="text-red-500">理由: {log.reason}</span>
                      )}
                      {log.ip && log.ip !== "unknown" && (
                        <span>IP: {log.ip}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
