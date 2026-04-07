"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";

const NAV_LINKS = [
  { href: "/admin", label: "ダッシュボード", exact: true, icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="1" y="1" width="6.5" height="6.5" rx="2" stroke="currentColor" strokeWidth="1.4"/>
      <rect x="10.5" y="1" width="6.5" height="6.5" rx="2" stroke="currentColor" strokeWidth="1.4"/>
      <rect x="1" y="10.5" width="6.5" height="6.5" rx="2" stroke="currentColor" strokeWidth="1.4"/>
      <rect x="10.5" y="10.5" width="6.5" height="6.5" rx="2" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  )},
  { href: "/admin/users", label: "ユーザー管理", exact: false, icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="5.5" r="3.2" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M2.5 15c0-3 3-5.5 6.5-5.5s6.5 2.5 6.5 5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )},
  { href: "/admin/reservations", label: "予約管理", exact: false, icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="1.5" y="2.5" width="15" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M5.5 1v2.5M12.5 1v2.5M1.5 7.5h15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )},
  { href: "/admin/events", label: "イベント管理", exact: false, icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M9 5.5v4l2.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )},
  { href: "/admin/news", label: "ニュース管理", exact: false, icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="1.5" y="2.5" width="15" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M5 7h8M5 10.5h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )},
  { href: "/admin/quests", label: "クエスト管理", exact: false, icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M9 2l2 4 4.5.7-3.3 3.1.8 4.5L9 12.2l-4 2.1.8-4.5L2.5 6.7 7 6l2-4z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
    </svg>
  )},
  { href: "/admin/admin-users", label: "管理者設定", exact: false, icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="5.5" r="3" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M3 15.5c0-2.8 2.7-5 6-5s6 2.2 6 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <circle cx="14" cy="4" r="2" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M14 3v2M13 4h2" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
    </svg>
  )},
  { href: "/admin/calendars", label: "カレンダー連携", exact: false, icon: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="1.5" y="2.5" width="15" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M5.5 1v2.5M12.5 1v2.5M1.5 7.5h15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <circle cx="12" cy="12" r="1.2" fill="currentColor"/>
    </svg>
  )},
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isLoginPage = pathname === "/admin/login";

  useEffect(() => {
    if (isLoginPage) {
      setChecking(false);
      return;
    }
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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 via-blue-50 to-indigo-50">
        <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
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
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-blue-50/80 to-indigo-100/60 relative overflow-hidden">
      {/* 背景デコレーション */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-gradient-to-br from-blue-200/40 to-indigo-200/30 rounded-full blur-3xl" />
        <div className="absolute top-1/3 -left-20 w-72 h-72 bg-gradient-to-br from-emerald-200/30 to-cyan-200/20 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-gradient-to-br from-purple-200/20 to-pink-200/15 rounded-full blur-3xl" />
      </div>

      <div className="relative flex min-h-screen">
        {/* モバイルオーバーレイ */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* サイドバー */}
        <aside
          className={`fixed md:sticky top-0 left-0 h-screen z-50 md:z-auto w-60 flex flex-col shrink-0 transition-transform duration-300 md:translate-x-0 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex flex-col h-full m-3 mr-0 rounded-2xl bg-white/40 backdrop-blur-xl border border-white/60 shadow-lg shadow-black/5">
            {/* ロゴ */}
            <div className="px-5 py-5">
              <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-0.5">EIGHT BASE UNGA</p>
              <h1 className="text-sm font-semibold text-slate-800">管理ダッシュボード</h1>
            </div>

            {/* ナビ */}
            <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
              {NAV_LINKS.map((link) => {
                const isActive = link.exact
                  ? pathname === link.href
                  : pathname.startsWith(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setSidebarOpen(false)}
                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] transition-all duration-200 ${
                      isActive
                        ? "bg-white/70 text-slate-900 font-semibold shadow-sm shadow-black/5 backdrop-blur-sm"
                        : "text-slate-500 hover:text-slate-800 hover:bg-white/40"
                    }`}
                  >
                    <span className={`${isActive ? "text-indigo-600" : "text-slate-400"} transition-colors`}>{link.icon}</span>
                    {link.label}
                  </Link>
                );
              })}
            </nav>

            {/* ログアウト */}
            <div className="px-3 py-4">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[13px] text-slate-400 hover:text-red-600 hover:bg-red-50/50 rounded-xl transition-all duration-200"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M7 2.5H4a1.5 1.5 0 00-1.5 1.5v10A1.5 1.5 0 004 15.5h3M12.5 12.5L16 9l-3.5-3.5M16 9H7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                ログアウト
              </button>
            </div>
          </div>
        </aside>

        {/* メインコンテンツ */}
        <main className="flex-1 overflow-auto">
          {/* モバイルヘッダー */}
          <div className="md:hidden sticky top-0 z-30 px-4 py-3 backdrop-blur-xl bg-white/50 border-b border-white/40">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-2 rounded-xl hover:bg-white/50 transition-colors"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
              <p className="text-xs font-semibold text-slate-600">EIGHT BASE UNGA</p>
              <div className="w-9" />
            </div>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
