"use client";

import { useEffect, useState, useMemo } from "react";
import dayjs from "dayjs";

/* ─── 型定義 ─── */

interface UserProfile {
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  phone: string;
  birthday: string;
  gender: string;
  occupation: string;
  purpose: string;
  postalCode: string;
  prefecture: string;
  city: string;
  address: string;
  building: string;
  addressType: string;
}

interface User {
  id: string;
  email: string;
  displayName: string;
  tenantName: string;
  lineUserId: string | null;
  active: boolean;
  profileComplete: boolean;
  profile: UserProfile | null;
  pictureUrl: string | null;
  lineDisplayName: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  profileUpdatedAt: string | null;
}

type SortKey = "displayName" | "email" | "tenantName" | "lineUserId" | "lastLoginAt" | "active" | "createdAt";
type SortDir = "asc" | "desc";
type StatusFilter = "all" | "active" | "inactive";
type LineFilter = "all" | "linked" | "unlinked";

const GENDER_LABELS: Record<string, string> = {
  male: "男性",
  female: "女性",
  other: "その他",
  prefer_not_to_say: "回答しない",
};

const ADDRESS_TYPE_LABELS: Record<string, string> = {
  home: "自宅住所",
  office: "会社住所",
};

/* ─── サブコンポーネント ─── */

function Badge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
        active ? "bg-[#B0E401]/20 text-[#231714]" : "bg-[#231714]/10 text-[#231714]/60"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${active ? "bg-[#B0E401]" : "bg-[#231714]/40"}`} />
      {active ? "有効" : "無効"}
    </span>
  );
}

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

/** プロフィール情報の1行 */
function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start py-2.5 border-b border-[#231714]/5 last:border-b-0">
      <span className="text-xs text-[#231714]/40 w-28 shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-[#231714] flex-1">{value || "—"}</span>
    </div>
  );
}

/* ─── 顧客詳細パネル ─── */

function UserDetailPanel({
  user,
  onClose,
  onToggleActive,
  onResetPassword,
}: {
  user: User;
  onClose: () => void;
  onToggleActive: (user: User) => void;
  onResetPassword: (user: User) => void;
}) {
  const p = user.profile;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-end z-50">
      {/* 背景クリックで閉じる */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* パネル本体 */}
      <div className="relative bg-white h-full w-full max-w-xl overflow-y-auto shadow-2xl animate-slideIn">
        {/* ヘッダー: プロフィール画像 + 基本情報 */}
        <div className="bg-gradient-to-br from-[#8BB5BF]/20 to-[#8BB5BF]/5 px-6 pt-6 pb-5">
          {/* 閉じるボタン */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/80 hover:bg-white flex items-center justify-center transition-colors shadow-sm"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="#231714" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>

          <div className="flex items-start gap-4">
            {/* プロフィール画像 */}
            {user.pictureUrl ? (
              <img
                src={user.pictureUrl}
                alt={user.displayName}
                className="w-20 h-20 rounded-2xl object-cover border-2 border-white shadow-md"
              />
            ) : (
              <div className="w-20 h-20 rounded-2xl bg-[#8BB5BF]/30 border-2 border-white shadow-md flex items-center justify-center">
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                  <path d="M16 4a6 6 0 016 6v0a6 6 0 01-12 0v0a6 6 0 016-6z" stroke="#8BB5BF" strokeWidth="2" />
                  <path d="M4 28c0-6.627 5.373-12 12-12s12 5.373 12 12" stroke="#8BB5BF" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
            )}

            <div className="flex-1 pt-1">
              <h2 className="text-xl font-bold text-[#231714]">{user.displayName}</h2>
              {p && (
                <p className="text-xs text-[#231714]/40 mt-0.5">
                  {p.lastNameKana} {p.firstNameKana}
                </p>
              )}
              <p className="text-sm text-[#231714]/60 mt-1">{p?.occupation || user.tenantName || "—"}</p>

              <div className="flex items-center gap-2 mt-3">
                <Badge active={user.active} />
                {user.lineUserId ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#06C755]/10 text-[#06C755] text-xs rounded-full font-medium">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M8.5 1.5l-5 5L1 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    LINE連携済み
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 bg-[#231714]/5 text-[#231714]/40 text-xs rounded-full">
                    LINE未連携
                  </span>
                )}
                {user.profileComplete ? (
                  <span className="inline-flex items-center px-2 py-0.5 bg-[#8BB5BF]/15 text-[#231714]/60 text-xs rounded-full">
                    プロフィール登録済み
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 bg-orange-50 text-orange-500 text-xs rounded-full">
                    プロフィール未登録
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* コンテンツ */}
        <div className="px-6 py-5 space-y-5">
          {/* 連絡先情報 */}
          <section>
            <h3 className="text-xs font-semibold text-[#231714]/40 uppercase tracking-wider mb-2 flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 1a3 3 0 013 3v0a3 3 0 01-6 0v0a3 3 0 013-3z" stroke="#8BB5BF" strokeWidth="1.2" />
                <path d="M2 13c0-2.761 2.239-5 5-5s5 2.239 5 5" stroke="#8BB5BF" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              連絡先情報
            </h3>
            <div className="bg-[#231714]/[0.02] rounded-xl px-4">
              <InfoRow label="メールアドレス" value={user.email} />
              <InfoRow label="電話番号" value={p?.phone ? p.phone.replace(/(\d{3})(\d{4})(\d{4})/, "$1-$2-$3") : null} />
              {user.lineDisplayName && (
                <InfoRow label="LINE表示名" value={user.lineDisplayName} />
              )}
            </div>
          </section>

          {/* 基本情報 */}
          <section>
            <h3 className="text-xs font-semibold text-[#231714]/40 uppercase tracking-wider mb-2 flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="2" y="3" width="10" height="9" rx="1.5" stroke="#8BB5BF" strokeWidth="1.2" />
                <path d="M4 3V2M10 3V2M2 6h10" stroke="#8BB5BF" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              基本情報
            </h3>
            <div className="bg-[#231714]/[0.02] rounded-xl px-4">
              <InfoRow label="生年月日" value={p?.birthday ? dayjs(p.birthday).format("YYYY年M月D日") : null} />
              <InfoRow label="性別" value={p?.gender ? GENDER_LABELS[p.gender] || p.gender : null} />
              <InfoRow label="職業・会社名" value={p?.occupation} />
              <InfoRow label="利用目的" value={p?.purpose} />
            </div>
          </section>

          {/* 住所情報 */}
          <section>
            <h3 className="text-xs font-semibold text-[#231714]/40 uppercase tracking-wider mb-2 flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 1.5l5 4v6.5a1 1 0 01-1 1H3a1 1 0 01-1-1V5.5l5-4z" stroke="#8BB5BF" strokeWidth="1.2" strokeLinejoin="round" />
                <path d="M5.5 13V9.5h3V13" stroke="#8BB5BF" strokeWidth="1.2" />
              </svg>
              住所情報
            </h3>
            <div className="bg-[#231714]/[0.02] rounded-xl px-4">
              <InfoRow label="住所種別" value={p?.addressType ? ADDRESS_TYPE_LABELS[p.addressType] || p.addressType : null} />
              <InfoRow label="郵便番号" value={p?.postalCode ? `〒${p.postalCode.replace(/(\d{3})(\d{4})/, "$1-$2")}` : null} />
              <InfoRow
                label="住所"
                value={p ? [p.prefecture, p.city, p.address, p.building].filter(Boolean).join(" ") || null : null}
              />
            </div>
          </section>

          {/* アカウント情報 */}
          <section>
            <h3 className="text-xs font-semibold text-[#231714]/40 uppercase tracking-wider mb-2 flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="3" y="5" width="8" height="7" rx="1.5" stroke="#8BB5BF" strokeWidth="1.2" />
                <path d="M5 5V3.5a2 2 0 014 0V5" stroke="#8BB5BF" strokeWidth="1.2" />
              </svg>
              アカウント情報
            </h3>
            <div className="bg-[#231714]/[0.02] rounded-xl px-4">
              <InfoRow label="登録日" value={user.createdAt ? dayjs(user.createdAt).format("YYYY年M月D日") : null} />
              <InfoRow label="最終ログイン" value={user.lastLoginAt ? dayjs(user.lastLoginAt).format("YYYY年M月D日 HH:mm") : null} />
              <InfoRow label="プロフィール更新" value={user.profileUpdatedAt ? dayjs(user.profileUpdatedAt).format("YYYY年M月D日 HH:mm") : null} />
            </div>
          </section>

          {/* アクションボタン */}
          <div className="flex gap-2 pt-2">
            <button
              onClick={() => onToggleActive(user)}
              className={`flex-1 py-2.5 text-sm rounded-xl border transition-colors ${
                user.active
                  ? "border-red-200 text-red-600 hover:bg-red-50"
                  : "border-[#B0E401]/40 text-[#231714] hover:bg-[#B0E401]/10"
              }`}
            >
              {user.active ? "アカウントを無効化" : "アカウントを有効化"}
            </button>
            <button
              onClick={() => onResetPassword(user)}
              className="flex-1 py-2.5 text-sm border border-[#8BB5BF]/40 text-[#231714] rounded-xl hover:bg-[#8BB5BF]/10 transition-colors"
            >
              パスワードリセット
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

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

  // 追加フォーム
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ email: "", displayName: "", tenantName: "", password: "" });
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [copiedPassword, setCopiedPassword] = useState(false);

  const generatePassword = () => {
    const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const lower = "abcdefghjkmnpqrstuvwxyz";
    const digits = "23456789";
    const symbols = "!@#$%&*";
    const all = upper + lower + digits + symbols;
    let pw = "";
    pw += upper[Math.floor(Math.random() * upper.length)];
    pw += lower[Math.floor(Math.random() * lower.length)];
    pw += digits[Math.floor(Math.random() * digits.length)];
    pw += symbols[Math.floor(Math.random() * symbols.length)];
    for (let i = 4; i < 12; i++) {
      pw += all[Math.floor(Math.random() * all.length)];
    }
    pw = pw.split("").sort(() => Math.random() - 0.5).join("");
    setAddForm((prev) => ({ ...prev, password: pw }));
    setShowPassword(true);
    setCopiedPassword(false);
  };

  const copyPassword = async () => {
    if (!addForm.password) return;
    try {
      await navigator.clipboard.writeText(addForm.password);
      setCopiedPassword(true);
      setTimeout(() => setCopiedPassword(false), 2000);
    } catch {
      // fallback
      const el = document.createElement("textarea");
      el.value = addForm.password;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopiedPassword(true);
      setTimeout(() => setCopiedPassword(false), 2000);
    }
  };

  // パスワードリセット
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  // アクション確認
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  // 顧客詳細
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // CSV エクスポート
  function handleExportCsv() {
    const target = filteredUsers.length > 0 ? filteredUsers : users;
    if (target.length === 0) return;

    const headers = [
      "姓", "名", "セイ", "メイ", "メールアドレス", "電話番号",
      "生年月日", "性別", "職業・会社名", "利用目的",
      "住所種別", "郵便番号", "都道府県", "市区町村", "番地", "建物名",
      "LINE連携", "LINE表示名", "ステータス", "登録日", "最終ログイン",
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
        p?.occupation ?? u.tenantName ?? "",
        p?.purpose ?? "",
        p?.addressType ? (ADDRESS_TYPE_LABELS[p.addressType] || p.addressType) : "",
        p?.postalCode ?? "",
        p?.prefecture ?? "",
        p?.city ?? "",
        p?.address ?? "",
        p?.building ?? "",
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

  const hasActiveFilter = statusFilter !== "all" || lineFilter !== "all" || searchQuery.trim() !== "";

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

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    setAddLoading(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(addForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "エラーが発生しました");
      setAddForm({ email: "", displayName: "", tenantName: "", password: "" });
      setShowAddForm(false);
      setShowPassword(false);
      setCopiedPassword(false);
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

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!resetTarget) return;
    setResetError(null);
    setResetLoading(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ id: resetTarget.id, newPassword: resetPassword }),
      });
      if (!res.ok) throw new Error();
      setResetTarget(null);
      setResetPassword("");
      setSelectedUser(null);
      setActionMsg(`${resetTarget.displayName} のパスワードをリセットしました`);
      await fetchUsers();
    } catch {
      setResetError("パスワードリセットに失敗しました");
    } finally {
      setResetLoading(false);
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
            ユーザーを追加
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

        {hasActiveFilter && (
          <button
            onClick={() => { setSearchQuery(""); setStatusFilter("all"); setLineFilter("all"); }}
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

      {/* ユーザー追加フォーム */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-base font-semibold text-[#231714] mb-4">ユーザーを追加</h3>
            <form onSubmit={handleAddUser} className="space-y-3">
              {[
                { field: "email", label: "メールアドレス", type: "email", placeholder: "user@example.com", required: true },
                { field: "displayName", label: "氏名", type: "text", placeholder: "山田 太郎", required: true },
                { field: "tenantName", label: "テナント名", type: "text", placeholder: "株式会社〇〇", required: false },
              ].map(({ field, label, type, placeholder, required }) => (
                <div key={field}>
                  <label className="block text-xs font-medium text-[#231714]/60 mb-1">{label}</label>
                  <input
                    type={type}
                    value={addForm[field as keyof typeof addForm]}
                    onChange={(e) => setAddForm({ ...addForm, [field]: e.target.value })}
                    placeholder={placeholder}
                    required={required}
                    className="w-full px-3 py-2.5 text-sm border border-[#231714]/10 rounded-xl focus:outline-none focus:border-[#231714] focus:ring-1 focus:ring-[#231714]"
                  />
                </div>
              ))}
              {/* 初期パスワード（生成・コピー・表示切替付き） */}
              <div>
                <label className="block text-xs font-medium text-[#231714]/60 mb-1">初期パスワード</label>
                <div className="flex gap-1.5">
                  <div className="relative flex-1">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={addForm.password}
                      onChange={(e) => { setAddForm({ ...addForm, password: e.target.value }); setCopiedPassword(false); }}
                      placeholder="8文字以上推奨"
                      required
                      className="w-full px-3 py-2.5 pr-9 text-sm border border-[#231714]/10 rounded-xl focus:outline-none focus:border-[#231714] focus:ring-1 focus:ring-[#231714] font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#231714]/40 hover:text-[#231714] transition-colors"
                      title={showPassword ? "パスワードを隠す" : "パスワードを表示"}
                    >
                      {showPassword ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      )}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={generatePassword}
                    className="px-3 py-2.5 text-xs font-medium bg-[#8BB5BF]/20 text-[#231714] border border-[#8BB5BF]/40 rounded-xl hover:bg-[#8BB5BF]/30 transition-colors whitespace-nowrap"
                    title="パスワードを自動生成"
                  >
                    生成
                  </button>
                  <button
                    type="button"
                    onClick={copyPassword}
                    disabled={!addForm.password}
                    className="px-3 py-2.5 text-xs font-medium bg-[#231714]/5 text-[#231714]/60 border border-[#231714]/10 rounded-xl hover:bg-[#231714]/10 disabled:opacity-30 transition-colors whitespace-nowrap"
                    title="パスワードをコピー"
                  >
                    {copiedPassword ? "✓" : "コピー"}
                  </button>
                </div>
              </div>
              {addError && (
                <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
                  <p className="text-xs text-red-600">{addError}</p>
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowAddForm(false); setAddError(null); setShowPassword(false); setCopiedPassword(false); }}
                  className="flex-1 py-2.5 text-sm border border-[#231714]/10 rounded-xl text-[#231714]/60 hover:bg-[#231714]/5 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={addLoading}
                  className="flex-1 py-2.5 text-sm bg-[#231714] text-white rounded-xl hover:bg-[#231714]/80 disabled:opacity-50 transition-colors"
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
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-[#231714] mb-1">パスワードをリセット</h3>
            <p className="text-sm text-[#231714]/60 mb-4">{resetTarget.displayName}（{resetTarget.email}）</p>
            <form onSubmit={handleResetPassword} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#231714]/60 mb-1">新しいパスワード</label>
                <input
                  type="password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  placeholder="新しいパスワードを入力"
                  required
                  minLength={4}
                  className="w-full px-3 py-2.5 text-sm border border-[#231714]/10 rounded-xl focus:outline-none focus:border-[#231714] focus:ring-1 focus:ring-[#231714]"
                />
              </div>
              <p className="text-xs text-[#231714]/40">※ リセット後、LINE ID 連携も解除されます</p>
              {resetError && <p className="text-xs text-red-600">{resetError}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => { setResetTarget(null); setResetPassword(""); setResetError(null); }}
                  className="flex-1 py-2.5 text-sm border border-[#231714]/10 rounded-xl text-[#231714]/60 hover:bg-[#231714]/5"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={resetLoading}
                  className="flex-1 py-2.5 text-sm bg-[#C5D94A] text-[#231714] rounded-xl hover:bg-[#B0E401] disabled:opacity-50"
                >
                  {resetLoading ? "リセット中..." : "リセット"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 顧客詳細パネル */}
      {selectedUser && (
        <UserDetailPanel
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onToggleActive={handleToggleActive}
          onResetPassword={(u) => { setResetTarget(u); }}
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
                    className="border-b border-[#231714]/5 hover:bg-[#8BB5BF]/5 transition-colors cursor-pointer"
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
                          <div className="w-8 h-8 rounded-full bg-[#8BB5BF]/20 flex items-center justify-center">
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                              <path d="M7 2a3 3 0 013 3v0a3 3 0 01-6 0v0a3 3 0 013-3z" stroke="#8BB5BF" strokeWidth="1.2" />
                              <path d="M2 13c0-2.761 2.239-5 5-5s5 2.239 5 5" stroke="#8BB5BF" strokeWidth="1.2" strokeLinecap="round" />
                            </svg>
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-[#231714]">{user.displayName}</p>
                          <p className="text-xs text-[#231714]/40">{user.profile?.occupation || user.tenantName || "—"}</p>
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
