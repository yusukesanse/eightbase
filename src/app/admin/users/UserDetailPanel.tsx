"use client";

import dayjs from "dayjs";
import { ROLE_LABELS, type UserRole } from "@/lib/roles";
import type { User } from "./types";
import { Badge, GENDER_LABELS, ADDRESS_TYPE_LABELS } from "./usersShared";

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

export function UserDetailPanel({
  user,
  onClose,
  onToggleActive,
  onReissuePasscode,
  onDelete,
  onSetRole,
}: {
  user: User;
  onClose: () => void;
  onToggleActive: (user: User) => void;
  onReissuePasscode: (user: User) => void;
  onDelete: (user: User) => void;
  onSetRole: (user: User, role: UserRole) => void;
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
                {user.role !== "member" && (
                  <span className="inline-flex items-center px-2 py-0.5 bg-[#2f7d57]/10 text-[#2f7d57] text-xs rounded-full font-medium">
                    {ROLE_LABELS[user.role]}
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

          {/* 区分変更（同一LINE IDのまま role を更新＝戦績は継承） */}
          <div className="pt-3">
            <p className="text-xs font-bold text-[#231714]/50 mb-1.5">区分</p>
            <div className="flex gap-2">
              {(["member", "guest", "staff"] as UserRole[]).map((r) => (
                <button
                  key={r}
                  onClick={() => user.role !== r && onSetRole(user, r)}
                  disabled={user.role === r}
                  className={`flex-1 py-2 text-sm rounded-xl font-medium transition-colors ${
                    user.role === r
                      ? "bg-[#231714] text-white cursor-default"
                      : "border border-[#231714]/15 text-[#231714] hover:bg-[#231714]/5"
                  }`}
                >
                  {ROLE_LABELS[r]}
                </button>
              ))}
            </div>
            <p className="text-xs text-[#231714]/30 mt-2">
              会員=全機能／ゲスト・エイト社員=ゲームのみ。麻雀の戦績は区分を変えても引き継がれます（会員化時はプロフィール登録が別途必要）。
            </p>
          </div>

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
