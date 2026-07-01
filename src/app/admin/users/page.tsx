"use client";

import { useEffect, useState, useMemo } from "react";
import dayjs from "dayjs";

/* ─── 型定義 ─── */

interface SocialLinksData {
  instagram?: string;
  x?: string;
  facebook?: string;
  other?: string;
}

interface UserProfile {
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  email?: string;
  phone: string;
  birthday: string;
  gender: string;
  companyName?: string;
  jobTitle?: string;
  industry?: string;
  occupation?: string; // 旧データ（後方互換）
  purpose: string;
  postalCode: string;
  prefecture: string;
  city: string;
  address: string;
  building: string;
  addressType: string;
  companyUrl?: string;
  bio?: string;
  lineUrl?: string;
  socialLinks?: SocialLinksData;
}

/** users.memberProfile（スキル・キャッチコピー等。LINE連携ユーザーのみ） */
interface MemberProfileData {
  skills?: string[];
  catchphrase?: string;
  companyName?: string;
  jobTitle?: string;
  industry?: string;
  companyUrl?: string;
  bio?: string;
  socialLinks?: SocialLinksData;
  lineUrl?: string;
}

interface User {
  id: string;
  email: string;
  displayName: string;
  tenantName: string;
  lineUserId: string | null;
  active: boolean;
  role: "member" | "guest";
  profileComplete: boolean;
  profile: UserProfile | null;
  memberProfile: MemberProfileData | null;
  pictureUrl: string | null;
  lineDisplayName: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  profileUpdatedAt: string | null;
  invitationId: string | null;
  inviteStatus: "pending" | "linked" | "expired" | null;
}

type SortKey = "displayName" | "email" | "tenantName" | "lineUserId" | "lastLoginAt" | "active" | "createdAt";
type SortDir = "asc" | "desc";
type StatusFilter = "all" | "active" | "inactive";
type LineFilter = "all" | "linked" | "unlinked";
type RoleFilter = "all" | "member" | "guest";

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
  onReissuePasscode,
  onDelete,
  onPromote,
}: {
  user: User;
  onClose: () => void;
  onToggleActive: (user: User) => void;
  onReissuePasscode: (user: User) => void;
  onDelete: (user: User) => void;
  onPromote: (user: User) => void;
}) {
  const p = user.profile;
  const mp = user.memberProfile;

  // profile（authorizedUsers）優先、memberProfile（users）/旧occupation でフォールバック
  const companyName = p?.companyName || p?.occupation || mp?.companyName || "";
  const jobTitle = p?.jobTitle || mp?.jobTitle || "";
  const industry = p?.industry || mp?.industry || "";
  const companyUrl = p?.companyUrl || mp?.companyUrl || "";
  const bio = p?.bio || mp?.bio || "";
  const lineUrl = p?.lineUrl || mp?.lineUrl || "";
  const catchphrase = mp?.catchphrase || "";
  const skills = mp?.skills || [];
  const sns = p?.socialLinks || mp?.socialLinks || {};
  const snsText =
    [
      sns.x && `X: ${sns.x}`,
      sns.instagram && `Instagram: ${sns.instagram}`,
      sns.facebook && `Facebook: ${sns.facebook}`,
      sns.other && `その他: ${sns.other}`,
    ]
      .filter(Boolean)
      .join("  /  ") || "";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-end z-50">
      {/* 背景クリックで閉じる */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* パネル本体 */}
      <div className="relative bg-white h-full w-full max-w-xl overflow-y-auto shadow-2xl animate-slideIn">
        {/* ヘッダー: プロフィール画像 + 基本情報 */}
        <div className="bg-gradient-to-br from-[#A5C1C8]/30 to-[#A5C1C8]/10 px-6 pt-6 pb-5">
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
              <div className="w-20 h-20 rounded-2xl bg-[#A5C1C8]/40 border-2 border-white shadow-md flex items-center justify-center">
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                  <path d="M16 4a6 6 0 016 6v0a6 6 0 01-12 0v0a6 6 0 016-6z" stroke="#A5C1C8" strokeWidth="2" />
                  <path d="M4 28c0-6.627 5.373-12 12-12s12 5.373 12 12" stroke="#A5C1C8" strokeWidth="2" strokeLinecap="round" />
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
              <p className="text-sm text-[#231714]/60 mt-1">{[companyName, jobTitle].filter(Boolean).join(" / ") || user.tenantName || "—"}</p>

              <div className="flex items-center gap-2 mt-3">
                <Badge active={user.active} />
                {user.role === "guest" && (
                  <span className="inline-flex items-center px-2 py-0.5 bg-[#2f7d57]/10 text-[#2f7d57] text-xs rounded-full font-medium">
                    ゲスト
                  </span>
                )}
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
                  <span className="inline-flex items-center px-2 py-0.5 bg-[#A5C1C8]/25 text-[#231714]/60 text-xs rounded-full">
                    プロフィール登録済み
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 bg-orange-50 text-orange-500 text-xs rounded-full">
                    プロフィール未登録
                  </span>
                )}
                {user.inviteStatus === "pending" && (
                  <span className="inline-flex items-center px-2 py-0.5 bg-amber-50 text-amber-600 text-xs rounded-full">
                    招待中
                  </span>
                )}
                {user.inviteStatus === "expired" && !user.lineUserId && (
                  <span className="inline-flex items-center px-2 py-0.5 bg-red-50 text-red-500 text-xs rounded-full">
                    招待期限切れ
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
                <path d="M7 1a3 3 0 013 3v0a3 3 0 01-6 0v0a3 3 0 013-3z" stroke="#A5C1C8" strokeWidth="1.2" />
                <path d="M2 13c0-2.761 2.239-5 5-5s5 2.239 5 5" stroke="#A5C1C8" strokeWidth="1.2" strokeLinecap="round" />
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
                <rect x="2" y="3" width="10" height="9" rx="1.5" stroke="#A5C1C8" strokeWidth="1.2" />
                <path d="M4 3V2M10 3V2M2 6h10" stroke="#A5C1C8" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              基本情報
            </h3>
            <div className="bg-[#231714]/[0.02] rounded-xl px-4">
              <InfoRow label="生年月日" value={p?.birthday ? dayjs(p.birthday).format("YYYY年M月D日") : null} />
              <InfoRow label="性別" value={p?.gender ? GENDER_LABELS[p.gender] || p.gender : null} />
              <InfoRow label="会社名・屋号" value={companyName} />
              <InfoRow label="職種" value={jobTitle} />
              <InfoRow label="業種" value={industry} />
              <InfoRow label="利用目的" value={p?.purpose} />
            </div>
          </section>

          {/* プロフィール・スキル */}
          <section>
            <h3 className="text-xs font-semibold text-[#231714]/40 uppercase tracking-wider mb-2 flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 1.5l1.6 3.3 3.6.5-2.6 2.5.6 3.6L7 9.7 3.8 11.4l.6-3.6L1.8 5.3l3.6-.5L7 1.5z" stroke="#A5C1C8" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
              プロフィール・スキル
            </h3>
            <div className="bg-[#231714]/[0.02] rounded-xl px-4">
              <InfoRow label="キャッチコピー" value={catchphrase} />
              <InfoRow label="スキル" value={skills.length > 0 ? skills.join("、") : null} />
              <InfoRow label="自己紹介" value={bio} />
              <InfoRow label="会社URL" value={companyUrl} />
              <InfoRow label="SNS" value={snsText || null} />
              <InfoRow label="LINE連絡先" value={lineUrl} />
            </div>
          </section>

          {/* 住所情報 */}
          <section>
            <h3 className="text-xs font-semibold text-[#231714]/40 uppercase tracking-wider mb-2 flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 1.5l5 4v6.5a1 1 0 01-1 1H3a1 1 0 01-1-1V5.5l5-4z" stroke="#A5C1C8" strokeWidth="1.2" strokeLinejoin="round" />
                <path d="M5.5 13V9.5h3V13" stroke="#A5C1C8" strokeWidth="1.2" />
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
                <rect x="3" y="5" width="8" height="7" rx="1.5" stroke="#A5C1C8" strokeWidth="1.2" />
                <path d="M5 5V3.5a2 2 0 014 0V5" stroke="#A5C1C8" strokeWidth="1.2" />
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
            {!user.lineUserId && (
              <button
                onClick={() => onReissuePasscode(user)}
                className="flex-1 py-2.5 text-sm border border-[#A5C1C8]/40 text-[#231714] rounded-xl hover:bg-[#A5C1C8]/20 transition-colors"
              >
                パスワード再発行
              </button>
            )}
          </div>

          {/* ゲスト → 会員へ昇格（同一LINE IDのまま role を更新＝戦績は継承） */}
          {user.role === "guest" && (
            <div className="pt-3">
              <button
                onClick={() => onPromote(user)}
                className="w-full py-2.5 text-sm border border-[#2f7d57]/40 text-[#2f7d57] rounded-xl hover:bg-[#2f7d57]/10 transition-colors font-medium"
              >
                会員に昇格する
              </button>
              <p className="text-xs text-[#231714]/30 text-center mt-2">
                全機能を利用可能に。麻雀の戦績はそのまま引き継がれます（プロフィール登録は別途必要）。
              </p>
            </div>
          )}

          {/* 完全削除ボタン */}
          <div className="pt-4 border-t border-[#231714]/5">
            <button
              onClick={() => onDelete(user)}
              className="w-full py-2.5 text-sm text-red-500 border border-red-200 rounded-xl hover:bg-red-50 transition-colors flex items-center justify-center gap-2"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 4h10M5 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4M11 4v7.5a1 1 0 01-1 1H4a1 1 0 01-1-1V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M6 7v3M8 7v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              ユーザーを完全に削除
            </button>
            <p className="text-xs text-[#231714]/30 text-center mt-2">
              予約データを含むすべての関連データが削除されます
            </p>
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
        u.role === "guest" ? "ゲスト" : "会員",
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

    if (roleFilter === "member") {
      result = result.filter((u) => u.role !== "guest");
    } else if (roleFilter === "guest") {
      result = result.filter((u) => u.role === "guest");
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
  const memberCount = useMemo(() => users.filter((u) => u.role !== "guest").length, [users]);
  const guestCount = users.length - memberCount;

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

  async function handlePromote(user: User) {
    if (!confirm(`${user.displayName} さんを会員に昇格しますか？（全機能が利用可能になります。麻雀の戦績は引き継がれます）`)) return;
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ id: user.id, role: "member" }),
      });
      if (!res.ok) throw new Error();
      setActionMsg(`${user.displayName} を会員に昇格しました`);
      setSelectedUser(null);
      await fetchUsers();
    } catch {
      setActionMsg("昇格に失敗しました");
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
          onPromote={handlePromote}
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
              <span className="ml-2 text-xs text-[#231714]/40">（会員 {memberCount}・ゲスト {guestCount}）</span>
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
                            {user.role === "guest" && (
                              <span className="inline-flex items-center px-1.5 py-0.5 bg-[#231714]/5 text-[#231714]/60 text-[10px] rounded-full font-medium">
                                ゲスト
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

/* ═══ 招待モーダル（メール送信 + ワンタイムパスワード） ═══ */

function InviteModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "guest">("member");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passcode, setPasscode] = useState<string | null>(null);
  const [guestUrl, setGuestUrl] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const isGuest = role === "guest";

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ displayName: name, email, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "エラーが発生しました");
      setPasscode(data.passcode ?? null);
      setGuestUrl(data.guestUrl ?? null);
      setEmailSent(data.emailSent ?? false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }

  async function copyPasscode() {
    const value = passcode ?? guestUrl;
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // 完了画面（emailSent=true or 手動共有用の passcode/guestUrl 取得済み）
  const showResult = emailSent || passcode || guestUrl;
  const fallbackValue = passcode ?? guestUrl; // メール失敗時に手動共有する値

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        {showResult ? (
          <>
            <div className="text-center mb-4">
              <div className={`w-12 h-12 rounded-full ${emailSent ? "bg-[#B0E401]/20" : "bg-orange-100"} flex items-center justify-center mx-auto mb-3`}>
                {emailSent ? (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M6 12l4 4 8-8" stroke="#B0E401" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M12 9v4M12 17h.01" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" />
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="#F59E0B" strokeWidth="1.5" />
                  </svg>
                )}
              </div>
              <h3 className="text-base font-semibold text-[#231714]">
                {emailSent
                  ? isGuest ? "ゲスト招待メールを送信しました" : "招待メールを送信しました"
                  : isGuest ? "ゲスト招待URLを発行しました" : "ワンタイムパスワードを発行しました"}
              </h3>
              <p className="text-xs text-[#231714]/50 mt-1">
                {emailSent
                  ? isGuest
                    ? `${email} 宛に参加用URLをメール送信しました（有効期限: 7日間）`
                    : `${email} 宛にパスワードをメール送信しました（有効期限: 7日間）`
                  : isGuest
                    ? `${name} さんにこのURLをLINEで開いてもらってください（有効期限: 7日間）`
                    : `${name} さんにこのパスワードを伝えてください（有効期限: 7日間）`}
              </p>
              {!emailSent && (
                <p className="text-xs text-orange-500 mt-1">
                  ※ メール送信に失敗しました。手動で{isGuest ? "URL" : "パスワード"}をお伝えください。
                </p>
              )}
            </div>

            {/* メール送信失敗時のみ手動共有用の値（member=パスコード / guest=URL）を表示 */}
            {fallbackValue && (
              <div className="bg-gray-50 rounded-xl p-4 mb-4 text-center">
                {isGuest ? (
                  <p className="text-xs font-mono text-[#231714] break-all">{fallbackValue}</p>
                ) : (
                  <p className="text-2xl font-bold font-mono tracking-[0.2em] text-[#231714]">{fallbackValue}</p>
                )}
              </div>
            )}

            <div className="flex gap-2">
              {fallbackValue && (
                <button
                  onClick={copyPasscode}
                  className="flex-1 py-2.5 text-sm font-medium bg-[#231714] text-white rounded-xl hover:bg-[#231714]/80 transition-colors"
                >
                  {copied ? "コピーしました" : "コピー"}
                </button>
              )}
              <button
                onClick={() => onCreated(`${name} さん${isGuest ? "にゲスト招待" : emailSent ? "に招待メール" : "のワンタイムパスワード"}${emailSent ? "を送信" : "を発行"}しました`)}
                className={`${fallbackValue ? "px-4" : "flex-1"} py-2.5 text-sm border border-[#231714]/10 rounded-xl text-[#231714]/60 hover:bg-[#231714]/5 transition-colors`}
              >
                閉じる
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-base font-semibold text-[#231714] mb-1">ユーザーを招待</h3>
            <p className="text-xs text-[#231714]/50 mb-4">
              {isGuest
                ? "ゲストは麻雀リーグなどのゲーム機能のみ利用できます。メールのワンタイムURLを開くと参加登録されます（予約・掲示板等は不可）。"
                : "会員は全機能を利用できます。ワンタイムパスワードを発行し、利用者がLINEのログイン画面で入力してアカウントを作成します。"}
            </p>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#231714]/60 mb-1">種別</label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { v: "member", label: "会員", desc: "全機能" },
                    { v: "guest", label: "ゲスト", desc: "ゲームのみ" },
                  ] as const).map((opt) => (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setRole(opt.v)}
                      className={`py-2 rounded-xl text-sm border transition-colors ${
                        role === opt.v
                          ? "border-[#231714] bg-[#231714] text-white"
                          : "border-[#231714]/15 text-[#231714]/70 hover:bg-[#231714]/5"
                      }`}
                    >
                      {opt.label}
                      <span className={`block text-[10px] ${role === opt.v ? "text-white/70" : "text-[#231714]/40"}`}>{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#231714]/60 mb-1">名前</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="山田 太郎"
                  required
                  className="w-full px-3 py-2.5 text-sm border border-[#231714]/10 rounded-xl focus:outline-none focus:border-[#231714] focus:ring-1 focus:ring-[#231714]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#231714]/60 mb-1">メールアドレス</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="taro@example.com"
                  required
                  className="w-full px-3 py-2.5 text-sm border border-[#231714]/10 rounded-xl focus:outline-none focus:border-[#231714] focus:ring-1 focus:ring-[#231714]"
                />
              </div>
              {error && (
                <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
                  <p className="text-xs text-red-600">{error}</p>
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={onClose} className="flex-1 py-2.5 text-sm border border-[#231714]/10 rounded-xl text-[#231714]/60 hover:bg-[#231714]/5 transition-colors">
                  キャンセル
                </button>
                <button type="submit" disabled={loading} className="flex-1 py-2.5 text-sm bg-[#231714] text-white rounded-xl hover:bg-[#231714]/80 disabled:opacity-50 transition-colors">
                  {loading ? "発行中..." : isGuest ? "ゲスト招待を送信" : "パスワードを発行"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

/* ═══ パスコード再発行モーダル ═══ */

function ReissuePasscodeModal({
  user,
  onClose,
  onReissued,
}: {
  user: User;
  onClose: () => void;
  onReissued: (msg: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passcode, setPasscode] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleReissue() {
    setError(null);
    setLoading(true);
    try {
      if (user.invitationId) {
        const res = await fetch("/api/admin/invitations", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ id: user.invitationId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setPasscode(data.passcode ?? null);
        setEmailSent(data.emailSent ?? false);
      } else {
        // invitationId がない旧ユーザー → 新規招待作成（emailが必要）
        if (!user.email) {
          throw new Error("メールアドレスが未登録のため再発行できません");
        }
        const res = await fetch("/api/admin/invitations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ displayName: user.displayName, email: user.email }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setPasscode(data.passcode ?? null);
        setEmailSent(data.emailSent ?? false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "再発行に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        {(emailSent || passcode) ? (
          <>
            <h3 className="text-base font-semibold text-[#231714] mb-1">
              {emailSent ? "招待メールを再送しました" : "パスワードを再発行しました"}
            </h3>
            <p className="text-xs text-[#231714]/50 mb-4">
              {emailSent
                ? `${user.email} 宛にパスワードをメール送信しました`
                : `${user.displayName} さんに新しいパスワードを伝えてください`}
            </p>
            {!emailSent && user.email && (
              <p className="text-xs text-orange-500 mb-2">※ メール送信に失敗しました。手動でパスワードをお伝えください。</p>
            )}
            {passcode && (
              <div className="bg-gray-50 rounded-xl p-4 mb-4 text-center">
                <p className="text-2xl font-bold font-mono tracking-[0.2em] text-[#231714]">{passcode}</p>
              </div>
            )}
            <div className="flex gap-2">
              {passcode && (
                <button
                  onClick={async () => { await navigator.clipboard.writeText(passcode); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                  className="flex-1 py-2.5 text-sm font-medium bg-[#231714] text-white rounded-xl hover:bg-[#231714]/80 transition-colors"
                >
                  {copied ? "コピーしました" : "コピー"}
                </button>
              )}
              <button
                onClick={() => onReissued(`${user.displayName} さん${emailSent ? "に招待メールを再送" : "のパスワードを再発行"}しました`)}
                className={`${passcode ? "px-4" : "flex-1"} py-2.5 text-sm border border-[#231714]/10 rounded-xl text-[#231714]/60 hover:bg-[#231714]/5 transition-colors`}
              >
                閉じる
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-base font-semibold text-[#231714] mb-1">パスワードを再発行</h3>
            <p className="text-sm text-[#231714]/60 mb-4">{user.displayName} さんのワンタイムパスワードを再発行します。以前のパスワードは無効になります。</p>
            {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 py-2.5 text-sm border border-[#231714]/10 rounded-xl text-[#231714]/60 hover:bg-[#231714]/5">
                キャンセル
              </button>
              <button onClick={handleReissue} disabled={loading} className="flex-1 py-2.5 text-sm bg-[#231714] text-white rounded-xl hover:bg-[#231714]/80 disabled:opacity-50">
                {loading ? "再発行中..." : "再発行する"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
