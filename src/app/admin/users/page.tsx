"use client";

import { useEffect, useState, useMemo } from "react";
import dayjs from "dayjs";
import { ROLE_LABELS, type UserRole } from "@/lib/roles";
import type { User } from "./types";
import { InviteModal } from "./InviteModal";
import { ReissuePasscodeModal } from "./ReissuePasscodeModal";
import { UserDetailPanel } from "./UserDetailPanel";
import { Badge, GENDER_LABELS, ADDRESS_TYPE_LABELS } from "./usersShared";

/* ─── 型定義（共有型は ./types へ分離） ─── */

type SortKey = "displayName" | "email" | "tenantName" | "lineUserId" | "lastLoginAt" | "active" | "createdAt";
type SortDir = "asc" | "desc";
type StatusFilter = "all" | "active" | "inactive";
type LineFilter = "all" | "linked" | "unlinked";
type RoleFilter = "all" | "member" | "guest" | "staff";

/* ─── サブコンポーネント ─── */

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" className="text-[#231714]/20 ml-1 inline-block">
        <path d="M6 2l3 3.5H3L6 2z" fill="currentColor" />
        <path d="M6 10L3 6.5h6L6 10z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" className="text-[#231714] ml-1 inline-block">
      {dir === "asc" ? (
        <path d="M6 2l3 4H3L6 2z" fill="currentColor" />
      ) : (
        <path d="M6 10L3 6h6L6 10z" fill="currentColor" />
      )}
    </svg>
  );
}

/* ─── 顧客詳細パネル ─── */

/* ─── メインページ ─── */

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
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");

  // 招待モーダル
  const [showAddForm, setShowAddForm] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // パスコード再発行
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  // アクション確認
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  // 顧客詳細
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // 削除確認
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  // CSV エクスポート
  function handleExportCsv() {
    const target = filteredUsers.length > 0 ? filteredUsers : users;
    if (target.length === 0) return;

    const headers = [
      "姓", "名", "セイ", "メイ", "メールアドレス", "電話番号",
      "生年月日", "性別", "職業・会社名", "利用目的",
      "住所種別", "郵便番号", "都道府県", "市区町村", "番地", "建物名",
      "区分", "LINE連携", "LINE表示名", "ステータス", "登録日", "最終ログイン",
    ];

    const rows = target.map((u) => {
      const p = u.profile;
      return [
        p?.lastName ?? "",
        p?.firstName ?? "",
        p?.lastNameKana ?? "",
        p?.firstNameKana ?? "",
        u.email,
        p?.phone ?? "",
        p?.birthday ?? "",
        p?.gender ? (GENDER_LABELS[p.gender] || p.gender) : "",
        [p?.companyName || p?.occupation, p?.jobTitle].filter(Boolean).join(" / ") || u.tenantName || "",
        p?.purpose ?? "",
        p?.addressType ? (ADDRESS_TYPE_LABELS[p.addressType] || p.addressType) : "",
        p?.postalCode ?? "",
        p?.prefecture ?? "",
        p?.city ?? "",
        p?.address ?? "",
        p?.building ?? "",
        ROLE_LABELS[u.role],
        u.lineUserId ? "連携済み" : "未連携",
        u.lineDisplayName ?? "",
        u.active ? "有効" : "無効",
        u.createdAt ? dayjs(u.createdAt).format("YYYY/MM/DD") : "",
        u.lastLoginAt ? dayjs(u.lastLoginAt).format("YYYY/MM/DD HH:mm") : "",
      ];
    });

    // BOM + CSV
    const csvContent = "\uFEFF" + [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ユーザー一覧_${dayjs().format("YYYYMMDD_HHmm")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

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

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (u) =>
          u.displayName.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          (u.tenantName && u.tenantName.toLowerCase().includes(q)) ||
          (u.profile?.phone && u.profile.phone.includes(q)) ||
          (u.profile?.companyName && u.profile.companyName.toLowerCase().includes(q)) ||
          (u.profile?.jobTitle && u.profile.jobTitle.toLowerCase().includes(q)) ||
          (u.profile?.occupation && u.profile.occupation.toLowerCase().includes(q))
      );
    }

    if (statusFilter === "active") {
      result = result.filter((u) => u.active);
    } else if (statusFilter === "inactive") {
      result = result.filter((u) => !u.active);
    }

    if (lineFilter === "linked") {
      result = result.filter((u) => u.lineUserId);
    } else if (lineFilter === "unlinked") {
      result = result.filter((u) => !u.lineUserId);
    }

    if (roleFilter !== "all") {
      result = result.filter((u) => u.role === roleFilter);
    }

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
  }, [users, searchQuery, statusFilter, lineFilter, roleFilter, sortKey, sortDir]);

  // 区分ごとの件数（全体・「分けて表示」の把握用）
  const memberCount = useMemo(() => users.filter((u) => u.role === "member").length, [users]);
  const guestCount = useMemo(() => users.filter((u) => u.role === "guest").length, [users]);
  const staffCount = useMemo(() => users.filter((u) => u.role === "staff").length, [users]);

  const hasActiveFilter =
    statusFilter !== "all" || lineFilter !== "all" || roleFilter !== "all" || searchQuery.trim() !== "";

  async function fetchUsers() {
    try {
      const res = await fetch("/api/admin/users", { credentials: "same-origin" });
      const data = await res.json();
      setUsers(data.users ?? []);
    } catch {
      setError("ユーザー一覧の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchUsers(); }, []); // eslint-disable-line

  async function handleToggleActive(user: User) {
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ id: user.id, active: !user.active }),
      });
      if (!res.ok) throw new Error();
      setActionMsg(user.active ? `${user.displayName} を無効にしました` : `${user.displayName} を有効にしました`);
      setSelectedUser(null);
      await fetchUsers();
    } catch {
      setActionMsg("更新に失敗しました");
    }
  }

  async function handleSetRole(user: User, role: UserRole) {
    if (!confirm(`${user.displayName} さんの区分を「${ROLE_LABELS[role]}」に変更しますか？（麻雀の戦績は引き継がれます）`)) return;
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ id: user.id, role }),
      });
      if (!res.ok) throw new Error();
      setActionMsg(`${user.displayName} を「${ROLE_LABELS[role]}」に変更しました`);
      setSelectedUser(null);
      await fetchUsers();
    } catch {
      setActionMsg("区分変更に失敗しました");
    }
  }

  async function handleDeleteUser() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ id: deleteTarget.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "エラーが発生しました");
      setDeleteTarget(null);
      setDeleteConfirmText("");
      setSelectedUser(null);
      setActionMsg(
        `${deleteTarget.displayName} を完全に削除しました${data.deletedReservations > 0 ? `（予約 ${data.deletedReservations} 件も削除）` : ""}`
      );
      await fetchUsers();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : "削除に失敗しました");
    } finally {
      setDeleteLoading(false);
    }
  }

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
      {/* スライドインアニメーション */}
      <style jsx global>{`
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-slideIn {
          animation: slideIn 0.25s ease-out;
        }
      `}</style>

      {/* ヘッダー */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#231714]">ユーザー管理</h2>
          <p className="text-sm text-[#231714]/40 mt-1">登録ユーザーの管理・追加</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCsv}
            disabled={users.length === 0}
            className="px-4 py-2.5 text-sm font-medium border border-[#231714]/10 text-[#231714]/60 rounded-xl hover:bg-[#231714]/5 disabled:opacity-30 transition-colors flex items-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1v8M4 6l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 10v2a1 1 0 001 1h8a1 1 0 001-1v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            CSV出力
          </button>
          <button
            onClick={() => setShowAddForm(true)}
            className="px-4 py-2.5 bg-[#231714] text-white text-sm font-medium rounded-xl hover:bg-[#231714]/80 transition-colors flex items-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
            ユーザーを招待
          </button>
        </div>
      </div>

      {/* 検索・フィルターバー */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="氏名・メール・テナント名・電話番号で検索..."
            className="w-full pl-9 pr-8 py-2.5 text-sm border border-[#231714]/10 rounded-xl bg-white focus:outline-none focus:border-[#231714] focus:ring-1 focus:ring-[#231714] transition-colors"
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

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className={`px-3 py-2.5 text-sm border rounded-xl bg-white focus:outline-none focus:border-[#231714] focus:ring-1 focus:ring-[#231714] transition-colors ${
            statusFilter !== "all" ? "border-[#231714] text-[#231714]" : "border-[#231714]/10 text-[#231714]/60"
          }`}
        >
          <option value="all">すべてのステータス</option>
          <option value="active">有効のみ</option>
          <option value="inactive">無効のみ</option>
        </select>

        <select
          value={lineFilter}
          onChange={(e) => setLineFilter(e.target.value as LineFilter)}
          className={`px-3 py-2.5 text-sm border rounded-xl bg-white focus:outline-none focus:border-[#231714] focus:ring-1 focus:ring-[#231714] transition-colors ${
            lineFilter !== "all" ? "border-[#231714] text-[#231714]" : "border-[#231714]/10 text-[#231714]/60"
          }`}
        >
          <option value="all">LINE連携：すべて</option>
          <option value="linked">連携済みのみ</option>
          <option value="unlinked">未連携のみ</option>
        </select>

        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
          className={`px-3 py-2.5 text-sm border rounded-xl bg-white focus:outline-none focus:border-[#231714] focus:ring-1 focus:ring-[#231714] transition-colors ${
            roleFilter !== "all" ? "border-[#231714] text-[#231714]" : "border-[#231714]/10 text-[#231714]/60"
          }`}
        >
          <option value="all">区分：すべて</option>
          <option value="member">会員のみ（{memberCount}）</option>
          <option value="guest">ゲストのみ（{guestCount}）</option>
          <option value="staff">エイト社員のみ（{staffCount}）</option>
        </select>

        {hasActiveFilter && (
          <button
            onClick={() => { setSearchQuery(""); setStatusFilter("all"); setLineFilter("all"); setRoleFilter("all"); }}
            className="px-3 py-2.5 text-xs text-[#231714]/60 border border-[#231714]/10 rounded-xl hover:bg-[#231714]/5 transition-colors flex items-center gap-1"
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
          <p className="text-sm text-[#231714]">{actionMsg}</p>
          <button onClick={() => setActionMsg(null)} className="text-[#231714]/60 text-xs hover:text-[#231714]">✕</button>
        </div>
      )}

      {/* ユーザー招待モーダル */}
      {showAddForm && (
        <InviteModal
          onClose={() => { setShowAddForm(false); setAddError(null); }}
          onCreated={(msg) => {
            setShowAddForm(false);
            setActionMsg(msg);
            fetchUsers();
          }}
        />
      )}

      {/* パスコード再発行モーダル */}
      {resetTarget && (
        <ReissuePasscodeModal
          user={resetTarget}
          onClose={() => { setResetTarget(null); setResetError(null); }}
          onReissued={(msg) => {
            setResetTarget(null);
            setActionMsg(msg);
          }}
        />
      )}

      {/* 削除確認モーダル */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[70] p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6v12a2 2 0 01-2 2H7a2 2 0 01-2-2V6" stroke="#EF4444" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M10 11v5M14 11v5" stroke="#EF4444" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </div>
            <h3 className="text-base font-semibold text-[#231714] text-center mb-1">ユーザーを完全に削除</h3>
            <p className="text-sm text-[#231714]/60 text-center mb-4">
              <span className="font-medium text-[#231714]">{deleteTarget.displayName}</span>（{deleteTarget.email}）の全データが削除されます。この操作は取り消せません。
            </p>
            <div className="bg-red-50/50 border border-red-100 rounded-xl px-3 py-2.5 mb-4">
              <p className="text-xs text-red-600 leading-relaxed">
                削除されるデータ: アカウント情報、プロフィール、LINE連携、すべての予約データ
              </p>
            </div>
            <div className="mb-4">
              <label className="block text-xs font-medium text-[#231714]/60 mb-1">
                確認のため「<span className="text-red-500 font-bold">削除</span>」と入力してください
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="削除"
                className="w-full px-3 py-2.5 text-sm border border-[#231714]/10 rounded-xl focus:outline-none focus:border-red-400 focus:ring-1 focus:ring-red-400"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setDeleteTarget(null); setDeleteConfirmText(""); }}
                className="flex-1 py-2.5 text-sm border border-[#231714]/10 rounded-xl text-[#231714]/60 hover:bg-[#231714]/5 transition-colors"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleDeleteUser}
                disabled={deleteConfirmText !== "削除" || deleteLoading}
                className="flex-1 py-2.5 text-sm bg-red-500 text-white rounded-xl hover:bg-red-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                {deleteLoading ? "削除中..." : "完全に削除"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 顧客詳細パネル */}
      {selectedUser && (
        <UserDetailPanel
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onToggleActive={handleToggleActive}
          onReissuePasscode={(u) => { setResetTarget(u); }}
          onDelete={(u) => { setDeleteTarget(u); }}
          onSetRole={handleSetRole}
        />
      )}

      {/* ユーザーテーブル */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-[#231714]/10 border-t-[#231714] rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-600">{error}</div>
      ) : (
        <div className="bg-white rounded-xl border border-[#231714]/10 overflow-hidden">
          <div className="px-6 py-4 border-b border-[#231714]/5 flex items-center justify-between">
            <p className="text-sm text-[#231714]/60">
              {hasActiveFilter ? (
                <>
                  <span className="font-medium text-[#231714]">{filteredUsers.length}</span>
                  <span> / {users.length} 名を表示</span>
                </>
              ) : (
                <>全 {users.length} 名</>
              )}
              <span className="ml-2 text-xs text-[#231714]/40">（会員 {memberCount}・ゲスト {guestCount}・エイト社員 {staffCount}）</span>
            </p>
            <p className="text-xs text-[#231714]/30">行をクリックで詳細表示</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#231714]/5 border-b border-[#231714]/5">
                  <SortableHeader label="氏名 / テナント" sortKeyName="displayName" />
                  <SortableHeader label="メールアドレス" sortKeyName="email" />
                  <SortableHeader label="LINE連携" sortKeyName="lineUserId" />
                  <SortableHeader label="最終ログイン" sortKeyName="lastLoginAt" />
                  <SortableHeader label="ステータス" sortKeyName="active" />
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => (
                  <tr
                    key={user.id}
                    onClick={() => setSelectedUser(user)}
                    className="border-b border-[#231714]/5 hover:bg-[#A5C1C8]/10 transition-colors cursor-pointer"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {user.pictureUrl ? (
                          <img
                            src={user.pictureUrl}
                            alt=""
                            className="w-8 h-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-[#A5C1C8]/30 flex items-center justify-center">
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                              <path d="M7 2a3 3 0 013 3v0a3 3 0 01-6 0v0a3 3 0 013-3z" stroke="#A5C1C8" strokeWidth="1.2" />
                              <path d="M2 13c0-2.761 2.239-5 5-5s5 2.239 5 5" stroke="#A5C1C8" strokeWidth="1.2" strokeLinecap="round" />
                            </svg>
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-[#231714] flex items-center gap-1.5">
                            {user.displayName}
                            {user.role !== "member" && (
                              <span className="inline-flex items-center px-1.5 py-0.5 bg-[#231714]/5 text-[#231714]/60 text-[10px] rounded-full font-medium">
                                {ROLE_LABELS[user.role]}
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-[#231714]/40">{user.profile?.companyName || user.profile?.occupation || user.tenantName || "—"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-[#231714]/60">{user.email}</td>
                    <td className="px-6 py-4">
                      {user.lineUserId ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#B0E401]/20 text-[#231714] text-xs rounded-full font-medium">
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path d="M8.5 1.5l-5 5L1 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                          連携済み
                        </span>
                      ) : (
                        <span className="text-xs text-[#231714]/40">未連携</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-xs text-[#231714]/60">
                      {user.lastLoginAt ? dayjs(user.lastLoginAt).format("YYYY/M/D HH:mm") : "—"}
                    </td>
                    <td className="px-6 py-4">
                      <Badge active={user.active} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filteredUsers.length === 0 && (
            <div className="px-6 py-12 text-center text-sm text-[#231714]/40">
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
