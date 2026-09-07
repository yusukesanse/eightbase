"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { clearAuthCache } from "@/components/AuthGuard";
import { initLiff } from "@/lib/liff";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { Avatar } from "@/components/ui/LineContact";
import { GlassCard, PageBg, PageHeading, StatusPill } from "@/components/ui/eb";

interface UserData {
  displayName: string;
  lineDisplayName: string;
  pictureUrl: string;
  catchphrase: string;
  skills: string[];
  postCount: number;
  reservationCount: number;
}

export default function MyPage() {
  const router = useRouter();

  // 前回データを即出し→裏で更新。auth 判定は API 側に任せ、401 等の失敗時のみログインへ。
  // 個人データ（投稿数・予約数・スキル等）なのでキャッシュしすぎない:
  // ttl:0 で毎回 revalidate（前回値は即表示しつつ常に最新を取り直す）。
  const { data: user, isLoading, error } = useStaleWhileRevalidate<UserData>(
    "mypage",
    async () => {
      const res = await fetch("/api/mypage", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) {
        router.replace("/login");
        throw new Error("unauthorized");
      }
      return res.json();
    },
    { ttl: 0 }
  );
  const loading = isLoading;

  // キャッシュも無く取得にも失敗した場合のみログインへ（古い表示があれば維持する）
  useEffect(() => {
    if (error && !user) router.replace("/login");
  }, [error, user, router]);

  if (loading) {
    return (
      <PageBg className="flex items-center justify-center">
        <div className="text-center">
          <div
            className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-2 border-t-transparent"
            style={{ borderColor: "var(--eb-green)", borderTopColor: "transparent" }}
          />
          <p className="text-[15px] text-[color:var(--eb-ink-muted)]">読み込み中...</p>
        </div>
      </PageBg>
    );
  }

  if (!user) return null;

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    clearAuthCache();
    // LIFF セッションもクリア（init してから logout しないと反映されない）
    try {
      const liff = await initLiff();
      if (liff.isLoggedIn()) liff.logout();
    } catch {
      /* LIFF未初期化/環境外は無視 */
    }
    // ログアウト直後の自動再ログインを抑止（HomePage が検知して停止）
    try {
      sessionStorage.setItem("eb_logged_out", "1");
    } catch {
      /* 無視 */
    }
    router.replace("/");
  }

  return (
    <PageBg>
      <div className="px-5 pt-[52px]">
        <PageHeading title="MY PAGE" />
      </div>

      <div className="px-5 pt-4 flex flex-col gap-4">
        {/* プロフィールカード */}
        <GlassCard>
          <div className="flex items-center gap-4">
            <Avatar src={user.pictureUrl} name={user.displayName || user.lineDisplayName} size={64} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[22px] font-bold text-[color:var(--eb-ink)]">
                {user.displayName || user.lineDisplayName}
              </p>
              {user.catchphrase && (
                <p className="mt-1 truncate text-[15px] text-[color:var(--eb-ink-muted)]">{user.catchphrase}</p>
              )}
            </div>
          </div>
        </GlassCard>

        {/* 統計 */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard value={user.skills.length} label="スキル" />
          <StatCard value={user.postCount} label="投稿" />
          <StatCard value={user.reservationCount} label="予約" />
        </div>

        {/* スキルタグ */}
        {user.skills.length > 0 && (
          <GlassCard padding="md">
            <div className="flex flex-wrap gap-1.5">
              {user.skills.map((skill) => (
                <StatusPill key={skill} tone="green">
                  {skill}
                </StatusPill>
              ))}
            </div>
          </GlassCard>
        )}

        {/* メニュー */}
        <GlassCard padding="md">
          <div className="flex flex-col divide-y divide-[color:var(--eb-line)]">
            <MenuRow
              icon={<BriefcaseIcon />}
              label="スキル・サービス設定"
              onClick={() => router.push("/mypage/skills")}
            />
            <MenuRow
              icon={<UserEditIcon />}
              label="プロフィール編集"
              onClick={() => router.push("/profile")}
            />
            <MenuRow
              icon={<HistoryIcon />}
              label="マイ予約"
              onClick={() => router.push("/my-reservations")}
            />
            <MenuRow icon={<LogoutIcon />} label="ログアウト" onClick={handleLogout} tone="coral" />
          </div>
        </GlassCard>
      </div>
    </PageBg>
  );
}

function StatCard({ value, label }: { value: number; label: string }) {
  return (
    <GlassCard padding="md">
      <div className="text-center">
        <p className="text-[24px] font-bold text-[color:var(--eb-ink)]">{value}</p>
        <p className="mt-0.5 text-[12px] text-[color:var(--eb-ink-muted)]">{label}</p>
      </div>
    </GlassCard>
  );
}

function MenuRow({
  icon,
  label,
  onClick,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  tone?: "coral";
}) {
  return (
    <button
      onClick={onClick}
      className="flex h-14 w-full items-center gap-3 text-left active:opacity-70 transition-opacity"
    >
      <span style={{ color: tone === "coral" ? "var(--eb-coral-text)" : "var(--eb-ink-muted)" }}>{icon}</span>
      <span
        className="flex-1 text-[15px] font-bold"
        style={{ color: tone === "coral" ? "var(--eb-coral-text)" : "var(--eb-ink)" }}
      >
        {label}
      </span>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path
          d="M5 3l4 4-4 4"
          stroke="var(--eb-ink-muted)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

function UserEditIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M10 3a3.5 3.5 0 013.5 3.5v0A3.5 3.5 0 0110 10v0a3.5 3.5 0 01-3.5-3.5v0A3.5 3.5 0 0110 3z" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M3 17c0-3.866 3.134-7 7-7s7 3.134 7 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  );
}
function BriefcaseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="2" y="6" width="16" height="11" rx="2" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M7 6V4.5A1.5 1.5 0 018.5 3h3A1.5 1.5 0 0113 4.5V6" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  );
}
function HistoryIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M10 6v4l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  );
}
function LogoutIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M7 17H4a1 1 0 01-1-1V4a1 1 0 011-1h3M13 14l4-4-4-4M17 10H8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
