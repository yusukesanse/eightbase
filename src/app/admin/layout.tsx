"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";

const NAV_LINKS = [
  { href: "/admin", label: "ダッシュボード", exact: true, icon: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="2" y="2" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="11" y="2" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="2" y="11" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="11" y="11" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  )},
  { href: "/admin/users", label: "ユーザー管理", exact: false, icon: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="6" r="3.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M3 17c0-3.3 3.1-6 7-6s7 2.7 7 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )},
  { href: "/admin/reservations", label: "予約管理", exact: false, icon: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="2" y="3" width="16" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M6 1.5v2.5M14 1.5v2.5M2 8h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )},
  { href: "/admin/events", label: "イベント管理", exact: false, icon: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M10 6v4.5l3 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )},
  { href: "/admin/news", label: "ニュース管理", exact: false, icon: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="2" y="3" width="16" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M6 8h8M6 11.5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )},
  { href: "/admin/quests", label: "クエスト管理", exact: false, icon: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M10 2.5l2.2 4.4 4.8.7-3.5 3.4.8 4.8-4.3-2.3-4.3 2.3.8-4.8L3 7.6l4.8-.7L10 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  )},
  { href: "/admin/admin-users", label: "管理者設定", exact: false, icon: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="2" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M10 1.5v2M10 16.5v2M18.5 10h-2M3.5 10h-2M16 4l-1.4 1.4M5.4 14.6L4 16M16 16l-1.4-1.4M5.4 5.4L4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )},
  { href: "/admin/calendars", label: "カレンダー連携", exact: false, icon: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="2" y="3" width="16" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M6 1.5v2.5M14 1.5v2.5M2 8h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="13" cy="13" r="1.5" fill="currentColor"/>
    </svg>
  )},
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);

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
      <div className="min-h-screen flex items-center justify-center bg-[#f0f4f5]">
        <div className="w-8 h-8 border-2 border-[#8BB5BF] border-t-transparent rounded-full animate-spin" />
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
    <div className="min-h-screen bg-[#f0f4f5] flex">
      {/* モバイルオーバーレイ */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── サイドバー (アイコン中心) ── */}
      <aside
        className={`fixed md:sticky top-0 left-0 h-screen z-50 shrink-0 transition-transform duration-300 md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex flex-col items-center h-full w-[72px] py-4 bg-white/80 backdrop-blur-xl border-r border-[#8BB5BF]/15">
          {/* ロゴ */}
          <div className="w-10 h-10 rounded-xl bg-[#231714] flex items-center justify-center mb-6">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <rect x="2" y="2" width="6" height="6" rx="1.5" fill="white" opacity="0.9"/>
              <rect x="10" y="2" width="6" height="6" rx="1.5" fill="white" opacity="0.5"/>
              <rect x="2" y="10" width="6" height="6" rx="1.5" fill="white" opacity="0.5"/>
              <rect x="10" y="10" width="6" height="6" rx="1.5" fill="white" opacity="0.3"/>
            </svg>
          </div>

          {/* ナビ */}
          <nav className="flex-1 flex flex-col items-center gap-1 w-full px-2">
            {NAV_LINKS.map((link) => {
              const isActive = link.exact
                ? pathname === link.href
                : pathname.startsWith(link.href);
              const isHover = hovered === link.href;
              return (
                <div key={link.href} className="relative">
                  <Link
                    href={link.href}
                    onClick={() => setSidebarOpen(false)}
                    onMouseEnter={() => setHovered(link.href)}
                    onMouseLeave={() => setHovered(null)}
                    className={`
                      flex items-center justify-center w-11 h-11 rounded-xl transition-all duration-200
                      ${isActive
                        ? "bg-[#8BB5BF] text-white shadow-md shadow-[#8BB5BF]/30"
                        : "text-[#231714]/40 hover:text-[#231714] hover:bg-[#8BB5BF]/10"
                      }
                    `}
                  >
                    {link.icon}
                  </Link>
                  {/* ツールチップ */}
                  {isHover && (
                    <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-2.5 py-1.5 bg-[#231714] text-white text-[11px] font-medium rounded-lg whitespace-nowrap z-[99999] shadow-lg pointer-events-none">
                      {link.label}
                      <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-[#231714]" />
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          {/* ログアウト */}
          <div className="relative">
            <button
              onClick={handleLogout}
              onMouseEnter={() => setHovered("logout")}
              onMouseLeave={() => setHovered(null)}
              className="flex items-center justify-center w-11 h-11 rounded-xl text-[#231714]/30 hover:text-red-500 hover:bg-red-50 transition-all duration-200"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M8 3H5a2 2 0 00-2 2v10a2 2 0 002 2h3M13.5 13.5L17 10l-3.5-3.5M17 10H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            {hovered === "logout" && (
              <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-2.5 py-1.5 bg-[#231714] text-white text-[11px] font-medium rounded-lg whitespace-nowrap z-[99999] shadow-lg pointer-events-none">
                ログアウト
                <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-[#231714]" />
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* ── メインコンテンツ ── */}
      <main className="flex-1 overflow-auto min-h-screen">
        {/* モバイルヘッダー */}
        <div className="md:hidden sticky top-0 z-30 px-4 py-3 bg-white/80 backdrop-blur-xl border-b border-[#8BB5BF]/15">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-xl hover:bg-[#8BB5BF]/10 transition-colors text-[#231714]"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
            <p className="text-xs font-semibold text-[#231714]/60 tracking-wider">EIGHT BASE UNGA</p>
            <div className="w-9" />
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
