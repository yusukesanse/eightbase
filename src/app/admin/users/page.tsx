"use client";

import { useEffect, useState, useMemo } from "react";
import dayjs from "dayjs";

interface User {
  id: string;
  email: string;
  displayName: string;
  tenantName: string;
  lineUserId: string | null;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

type SortKey = "displayName" | "email" | "tenantName" | "lineUserId" | "lastLoginAt" | "active" | "createdAt";
type SortDir = "asc" | "desc";

type StatusFilter = "all" | "active" | "inactive";
type LineFilter = "all" | "linked" | "unlinked";

function Badge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
        active ? "bg-[#B0E401]/20 text-[#414141]" : "bg-[#414141]/10 text-[#414141]/60"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${active ? "bg-[#B0E401]" : "bg-[#414141]/40"}`} />
      {active ? "有効" : "無効"}
    </span>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" className="text-[#414141]/20 ml-1 inline-block">
        <path d="M6 2l3 3.5H3L6 2z" fill="currentColor" />
        <path d="M6 10L3 6.5h6L6 10z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" className="text-[#414141] ml-1 inline-block">
      {dir === "asc" ? (
        <path d="M6 2l3 4H3L6 2z" fill="currentColor" />
      ) : (
        <path d="M6 10L3 6h6L6 10z" fill="currentColor" />
      )}
    </svg>
  );
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ソート
  const [sortKey, setSortKey] = useState<SortKey>("displayName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // 検索
  const [searchQuery, setSearchQuery] = useState("");

  // フィルター
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [lineFilter, setLineFilter] = useState<LineFilter>("all");

  // 追加フォーム
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ email: "", displayName: "", tenantName: "", password: "" });
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // パスワードリセット
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  // アクション確認
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  // ソート切替
  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  // フィルター・検索・ソート適用
  const filteredUsers = useMemo(() => {
    let result = [...users];

    // 検索（氏名、メール、テナント名で部分一致）
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (u) =>
          u.displayName.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          (u.tenantName && u.tenantName.toLowerCase().includes(q))
      );
    }

    // ステータスフィルター
    if (statusFilter === "active") {
      result = result.filter((u) => u.active);
    } else if (statusFilter === "inactive") {
      result = result.filter((u) => !u.active);
    }

    // LINE連携フィルター
    if (lineFilter === "linked") {
      result = result.filter((u) => u.lineUserId);
    } else if (lineFilter === "unlinked") {
      result = result.filter((u) => !u.lineUserId);
    }

    // ソート
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "displayName":
          cmp = a.displayName.localeCompare(b.displayName, "ja");
          break;
        case "email":
          cmp = a.email.localeCompare(b.email);
          break;
        case "tenantName":
          cmp = (a.tenantName || "").localeCompare(b.tenantName || "", "ja");
          break;
        case "lineUserId":
          cmp = (a.lineUserId ? 1 : 0) - (b.lineUserId ? 1 : 0);
          break;
        case "lastLoginAt": {
          const ta = a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0;
          const tb = b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0;
          cmp = ta - tb;
          break;
        }
        case "active":
          cmp = (a.active ? 1 : 0) - (b.active ? 1 : 0);
          break;
        case "createdAt": {
          const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          cmp = ca - cb;
          break;
        }
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return result;
  }, [users, searchQuery, statusFilter, lineFilter, sortKey, sortDir]);

  // フィルターがアクティブかどうか
  const hasActiveFilter = statusFilter !== "all" || lineFilter !== "all" || searchQuery.trim() !== "";

  async function fetchUsers() {
    try {
      const res = await fetch("/api/admin/users", {
        credentials: "same-origin",
      });
      const data = await res.json();
      setUsers(data.users ?? []);
    } catch {
      setError("ユーザー一覧の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchUsers(); }, []); // eslint-disable-line

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    setAddLoading(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify(addForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "エラーが発生しました");
      setAddForm({ email: "", displayName: "", tenantName: "", password: "" });
      setShowAddForm(false);
      setActionMsg("ユーザーを追加しました");
      await fetchUsers();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setAddLoading(false);
    }
  }

  async function handleToggleActive(user: User) {
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({ id: user.id, active: !user.active }),
      });
      if (!res.ok) throw new Error();
      setActionMsg(user.active ? `${user.displayName} を無効にしました` : `${user.displayName} を有効にしました`);
      await fetchUsers();
    } catch {
      setActionMsg("更新に失敗しました");
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!resetTarget) return;
    setResetError(null);
    setResetLoading(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({ id: resetTarget.id, newPassword: resetPassword }),
      });
      if (!res.ok) throw new Error();
      setResetTarget(null);
      setResetPassword("");
      setActionMsg(`${resetTarget.displayName} のパスワードをリセットしました`);
      await fetchUsers();
    } catch {
      setResetError("パスワードリセットに失敗しました");
    } finally {
      setResetLoading(false);
    }
  }

  // ソート可能なヘッダーセル
  function SortableHeader({ label, sortKeyName, className }: { label: string; sortKeyName: SortKey; className?: string }) {
    return (
      <th
        className={`text-left px-6 py-3 text-xs font-medium text-gray-500 cursor-pointer select-none hover:text-gray-800 transition-colors ${className ?? ""}`}
        onClick={() => handleSort(sortKeyName)}
      >
        {label}
        <SortIcon active={sortKey === sortKeyName} dir={sortDir} />
      </th>
    );
  }

  return (
    <div className="p-8">
      {/* ヘッダー */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#414141]">ユーザー管理</h2>
          <p className="text-sm text-[#414141]/40 mt-1">登録ユーザーの管理・追加</p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="px-4 py-2.5 bg-[#414141] text-white text-sm font-medium rounded-xl hover:bg-[#414141]/80 transition-colors flex items-center gap-2"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
          ユーザーを追加
        </button>
      </div>

      {/* 検索・フィルターバー */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* 検索 */}
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          >
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="氏名・メール・テナント名で検索..."
            className="w-full pl-9 pr-8 py-2.5 text-sm border border-[#414141]/10 rounded-xl bg-white focus:outline-none focus:border-[#414141] focus:ring-1 focus:ring-[#414141] transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>

        {/* ステータスフィルター */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className={`px-3 py-2.5 text-sm border rounded-xl bg-white focus:outline-none focus:border-[#414141] focus:ring-1 focus:ring-[#414141] transition-colors ${
            statusFilter !== "all" ? "border-[#414141] text-[#414141]" : "border-[#414141]/10 text-[#414141]/60"
          }`}
        >
          <option value="all">すべてのステータス</option>
          <option value="active">有効のみ</option>
          <option value="inactive">無効のみ</option>
        </select>

        {/* LINE連携フィルター */}
        <select
          value={lineFilter}
          onChange={(e) => setLineFilter(e.target.value as LineFilter)}
          className={`px-3 py-2.5 text-sm border rounded-xl bg-white focus:outline-none focus:border-[#414141] focus:ring-1 focus:ring-[#414141] transition-colors ${
            lineFilter !== "all" ? "border-[#414141] text-[#414141]" : "border-[#414141]/10 text-[#414141]/60"
          }`}
        >
          <option value="all">LINE連携：すべて</option>
          <option value="linked">連携済みのみ</option>
          <option value="unlinked">未連携のみ</option>
        </select>

        {/* フィルターリセット */}
        {hasActiveFilter && (
          <button
            onClick={() => {
              setSearchQuery("");
              setStatusFilter("all");
              setLineFilter("all");
            }}
            className="px-3 py-2.5 text-xs text-[#414141]/60 border border-[#414141]/10 rounded-xl hover:bg-[#414141]/5 transition-colors flex items-center gap-1"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            リセット
          </button>
        )}
      </div>

      {/* 成功メッセージ */}
      {actionMsg && (
        <div className="mb-4 bg-[#B0E401]/20 border border-[#B0E401]/40 rounded-xl px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-[#414141]">{actionMsg}</p>
          <button onClick={() => setActionMsg(null)} className="text-[#414141]/60 text-xs hover:text-[#414141]">✕</button>
        </div>
      )}

      {/* ユーザー追加フォーム */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-base font-semibold text-[#414141] mb-4">ユーザーを追加</h3>
            <form onSubmit={handleAddUser} className="space-y-3">
              {[
                { field: "email", label: "メールアドレス", type: "email", placeholder: "user@example.com", required: true },
                { field: "displayName", label: "氏名", type: "text", placeholder: "山田 太郎", required: true },
                { field: "tenantName", label: "テナント名", type: "text", placeholder: "株式会社〇〇", required: false },
                { field: "password", label: "初期パスワード", type: "password", placeholder: "8文字以上推奨", required: true },
              ].map(({ field, label, type, placeholder, required }) => (
                <div key={field}>
                  <label className="block text-xs font-medium text-[#414141]/60 mb-1">{label}</label>
                  <input
                    type={type}
                    value={addForm[field as keyof typeof addForm]}
                    onChange={(e) => setAddForm({ ...addForm, [field]: e.target.value })}
                    placeholder={placeholder}
                    required={required}
                    className="w-full px-3 py-2.5 text-sm border border-[#414141]/10 rounded-xl focus:outline-none focus:border-[#414141] focus:ring-1 focus:ring-[#414141]"
                  />
                </div>
              ))}

              {addError && (
                <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
                  <p className="text-xs text-red-600">{addError}</p>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowAddForm(false); setAddError(null); }}
                  className="flex-1 py-2.5 text-sm border border-[#414141]/10 rounded-xl text-[#414141]/60 hover:bg-[#414141]/5 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={addLoading}
                  className="flex-1 py-2.5 text-sm bg-[#414141] text-white rounded-xl hover:bg-[#414141]/80 disabled:opacity-50 transition-colors"
                >
                  {addLoading ? "追加中..." : "追加する"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* パスワードリセットモーダル */}
      {resetTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-[#414141] mb-1">パスワードをリセット</h3>
            <p className="text-sm text-[#414141]/60 mb-4">{resetTarget.displayName}（{resetTarget.email}）</p>
            <form onSubmit={handleResetPassword} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#414141]/60 mb-1">新しいパスワード</label>
                <input
                  type="password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  placeholder="新しいパスワードを入力"
                  required
                  minLength={4}
                  className="w-full px-3 py-2.5 text-sm border border-[#414141]/10 rounded-xl focus:outline-none focus:border-[#414141] focus:ring-1 focus:ring-[#414141]"
                />
              </div>
              <p className="text-xs text-[#414141]/40">※ リセット後、LINE ID 連携も解除されます</p>
              {resetError && (
                <p className="text-xs text-red-600">{resetError}</p>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => { setResetTarget(null); setResetPassword(""); setResetError(null); }}
                  className="flex-1 py-2.5 text-sm border border-[#414141]/10 rounded-xl text-[#414141]/60 hover:bg-[#414141]/5"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={resetLoading}
                  className="flex-1 py-2.5 text-sm bg-[#C5D94A] text-[#414141] rounded-xl hover:bg-[#B0E401] disabled:opacity-50"
                >
                  {resetLoading ? "リセット中..." : "リセット"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ユーザーテーブル */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-[#414141]/10 border-t-[#414141] rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-600">{error}</div>
      ) : (
        <div className="bg-white rounded-xl border border-[#414141]/10 overflow-hidden">
          <div className="px-6 py-4 border-b border-[#414141]/5 flex items-center justify-between">
            <p className="text-sm text-[#414141]/60">
              {hasActiveFilter ? (
                <>
                  <span className="font-medium text-[#414141]">{filteredUsers.length}</span>
                  <span> / {users.length} 名を表示</span>
                </>
              ) : (
                <>全 {users.length} 名</>
              )}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#414141]/5 border-b border-[#414141]/5">
                  <SortableHeader label="氏名 / テナント" sortKeyName="displayName" />
                  <SortableHeader label="メールアドレス" sortKeyName="email" />
                  <SortableHeader label="LINE連携" sortKeyName="lineUserId" />
                  <SortableHeader label="最終ログイン" sortKeyName="lastLoginAt" />
                  <SortableHeader label="ステータス" sortKeyName="active" />
                  <th className="text-left px-6 py-3 text-xs font-medium text-[#414141]/60">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => (
                  <tr key={user.id} className="border-b border-[#414141]/5 hover:bg-[#414141]/5 transition-colors">
                    <td className="px-6 py-4">
                      <p className="font-medium text-[#414141]">{user.displayName}</p>
                      <p className="text-xs text-[#414141]/40">{user.tenantName || "—"}</p>
                    </td>
                    <td className="px-6 py-4 text-[#414141]/60">{user.email}</td>
                    <td className="px-6 py-4">
                      {user.lineUserId ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#B0E401]/20 text-[#414141] text-xs rounded-full font-medium">
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                            <path d="M8.5 1.5l-5 5L1 4"/>
                          </svg>
                          連携済み
                        </span>
                      ) : (
                        <span className="text-xs text-[#414141]/40">未連携</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-xs text-[#414141]/60">
                      {user.lastLoginAt ? dayjs(user.lastLoginAt).format("YYYY/M/D HH:mm") : "—"}
                    </td>
                    <td className="px-6 py-4">
                      <Badge active={user.active} />
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleToggleActive(user)}
                          className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
                            user.active
                              ? "border-red-200 text-red-600 hover:bg-red-50"
                              : "border-[#B0E401]/40 text-[#414141] hover:bg-[#B0E401]/10"
                          }`}
                        >
                          {user.active ? "無効化" : "有効化"}
                        </button>
                        <button
                          onClick={() => setResetTarget(user)}
                          className="px-2.5 py-1.5 text-xs rounded-lg border border-[#C5D94A]/40 text-[#414141] hover:bg-[#C5D94A]/10 transition-colors"
                        >
                          PW リセット
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filteredUsers.length === 0 && (
            <div className="px-6 py-12 text-center text-sm text-[#414141]/40">
              {hasActiveFilter
                ? "条件に一致するユーザーが見つかりません。"
                : "ユーザーがいません。まず追加してください。"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
