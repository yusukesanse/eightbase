"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";

const NAV_LINKS = [
  { href: "/admin", label: "ダッシュボード", exact: true, icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      <rect x="9" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      <rect x="1" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      <rect x="9" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  )},
  { href: "/admin/users", label: "ユーザー管理", exact: false, icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M2 13c0-2.761 2.686-5 6-5s6 2.239 6 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )},
  { href: "/admin/reservations", label: "予約管理", exact: false, icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="2" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M5 1v2M11 1v2M1 7h14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )},
  { href: "/admin/events", label: "イベント管理", exact: false, icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M8 5v3.5l2.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )},
  { href: "/admin/news", label: "ニュース管理", exact: false, icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M4 6h8M4 9h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )},
  { href: "/admin/quests", label: "クエスト管理", exact: false, icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 2l1.8 3.6L14 6.4l-3 2.9.7 4.1L8 11.4l-3.7 2 .7-4.1L2 6.4l4.2-.8L8 2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
    </svg>
  )},
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);

  const isLoginPage = pathname === "/admin/login";

  useEffect(() => {
    if (isLoginPage) {
      setChecking(false);
      return;
    }
    // Cookie ベースの認証チェック
    fetch("/api/admin/auth", { credentials: "same-origin" })
      .then((res) => {
        if (res.ok) {
          setChecking(false);
        } else {
          router.replace("/admin/login");
        }
      })
      .catch(() => {
        router.replace("/admin/login");
      });
  }, [pathname, router, isLoginPage]);

  if (isLoginPage) {
    return <>{children}</>;
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-2 border-gray-800 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  async function handleLogout() {
    await fetch("/api/admin/auth", {
      method: "DELETE",
      credentials: "same-origin",
    });
    router.replace("/admin/login");
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* サイドバー（md以上で表示、スマホでは非表示） */}
      <aside className="hidden md:flex w-56 bg-gray-900 text-white flex-col shrink-0">
        {/* ロゴ */}
        <div className="px-5 py-5 border-b border-white/10">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">Eight Canal Base</p>
          <h1 className="text-sm font-semibold text-white">管理ダッシュボード</h1>
        </div>

        {/* ナビ */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV_LINKS.map((link) => {
            const isActive = link.exact
              ? pathname === link.href
              : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive
                    ? "bg-white/10 text-white font-medium"
                    : "text-gray-400 hover:text-white hover:bg-white/5"
                }`}
              >
                <span className={isActive ? "text-white" : "text-gray-500"}>{link.icon}</span>
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* ログアウト */}
        <div className="px-3 py-4 border-t border-white/10">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3M11 11l3-3-3-3M14 8H6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            ログアウト
          </button>
        </div>
      </aside>

      {/* メインコンテンツ */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
