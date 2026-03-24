"use client";

import { useEffect, useState } from "react";
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

function Badge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
        active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${active ? "bg-green-500" : "bg-gray-400"}`} />
      {active ? "有効" : "無効"}
    </span>
  );
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  function getToken() {
    return sessionStorage.getItem("admin_token") ?? "";
  }

  async function fetchUsers() {
    try {
      const res = await fetch("/api/admin/users", {
        headers: { Authorization: `Bearer ${getToken()}` },
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
          Authorization: `Bearer ${getToken()}`,
        },
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
          Authorization: `Bearer ${getToken()}`,
        },
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
          Authorization: `Bearer ${getToken()}`,
        },
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

  return (
    <div className="p-8">
      {/* ヘッダー */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">ユーザー管理</h2>
          <p className="text-sm text-gray-400 mt-1">登録ユーザーの管理・追加</p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="px-4 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-700 transition-colors flex items-center gap-2"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
          ユーザーを追加
        </button>
      </div>

      {/* 成功メッセージ */}
      {actionMsg && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-green-700">{actionMsg}</p>
          <button onClick={() => setActionMsg(null)} className="text-green-500 text-xs hover:text-green-700">✕</button>
        </div>
      )}

      {/* ユーザー追加フォーム */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-4">ユーザーを追加</h3>
            <form onSubmit={handleAddUser} className="space-y-3">
              {[
                { field: "email", label: "メールアドレス", type: "email", placeholder: "user@example.com", required: true },
                { field: "displayName", label: "氏名", type: "text", placeholder: "山田 太郎", required: true },
                { field: "tenantName", label: "テナント名", type: "text", placeholder: "株式会社〇〇", required: false },
                { field: "password", label: "初期パスワード", type: "password", placeholder: "8文字以上推奨", required: true },
              ].map(({ field, label, type, placeholder, required }) => (
                <div key={field}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                  <input
                    type={type}
                    value={addForm[field as keyof typeof addForm]}
                    onChange={(e) => setAddForm({ ...addForm, [field]: e.target.value })}
                    placeholder={placeholder}
                    required={required}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-gray-800 focus:ring-1 focus:ring-gray-800"
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
                  className="flex-1 py-2.5 text-sm border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={addLoading}
                  className="flex-1 py-2.5 text-sm bg-gray-900 text-white rounded-xl hover:bg-gray-700 disabled:opacity-50 transition-colors"
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
            <h3 className="text-base font-semibold text-gray-900 mb-1">パスワードをリセット</h3>
            <p className="text-sm text-gray-500 mb-4">{resetTarget.displayName}（{resetTarget.email}）</p>
            <form onSubmit={handleResetPassword} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">新しいパスワード</label>
                <input
                  type="password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  placeholder="新しいパスワードを入力"
                  required
                  minLength={4}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-gray-800 focus:ring-1 focus:ring-gray-800"
                />
              </div>
              <p className="text-xs text-gray-400">※ リセット後、LINE ID 連携も解除されます</p>
              {resetError && (
                <p className="text-xs text-red-600">{resetError}</p>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => { setResetTarget(null); setResetPassword(""); setResetError(null); }}
                  className="flex-1 py-2.5 text-sm border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={resetLoading}
                  className="flex-1 py-2.5 text-sm bg-amber-500 text-white rounded-xl hover:bg-amber-600 disabled:opacity-50"
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
          <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-600">{error}</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <p className="text-sm text-gray-500">全 {users.length} 名</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500">氏名 / テナント</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500">メールアドレス</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500">LINE連携</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500">最終ログイン</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500">ステータス</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <p className="font-medium text-gray-900">{user.displayName}</p>
                    <p className="text-xs text-gray-400">{user.tenantName || "—"}</p>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{user.email}</td>
                  <td className="px-6 py-4">
                    {user.lineUserId ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full font-medium">
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                          <path d="M8.5 1.5l-5 5L1 4"/>
                        </svg>
                        連携済み
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">未連携</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-xs text-gray-500">
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
                            : "border-green-200 text-green-600 hover:bg-green-50"
                        }`}
                      >
                        {user.active ? "無効化" : "有効化"}
                      </button>
                      <button
                        onClick={() => setResetTarget(user)}
                        className="px-2.5 py-1.5 text-xs rounded-lg border border-amber-200 text-amber-600 hover:bg-amber-50 transition-colors"
                      >
                        PW リセット
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && (
            <div className="px-6 py-12 text-center text-sm text-gray-400">
              ユーザーがいません。まず追加してください。
            </div>
          )}
        </div>
      )}
    </div>
  );
}
