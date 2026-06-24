"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";

/* ── ナビゲーション定義 ── */

interface NavItem {
  href: string;
  label: string;
  exact?: boolean;
  icon: React.ReactNode;
  children?: { href: string; label: string; icon: React.ReactNode }[];
}

const NAV_ITEMS: NavItem[] = [
  {
    href: "/admin",
    label: "ダッシュボード",
    exact: true,
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="2" y="2" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <rect x="11" y="2" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <rect x="2" y="11" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <rect x="11" y="11" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    href: "/admin/users",
    label: "ユーザー管理",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="6" r="3.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3 17c0-3.3 3.1-6 7-6s7 2.7 7 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/admin/reservations",
    label: "予約管理",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="2" y="3" width="16" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6 1.5v2.5M14 1.5v2.5M2 8h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/admin/notifications",
    label: "通知",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M10 2.5a4.5 4.5 0 0 0-4.5 4.5c0 4-2 5-2 5h13s-2-1-2-5A4.5 4.5 0 0 0 10 2.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M8.5 16.5a1.8 1.8 0 0 0 3 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/admin/calendars",
    label: "カレンダー管理",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="2" y="3" width="16" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6 1.5v2.5M14 1.5v2.5M2 8h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="13" cy="13" r="1.5" fill="currentColor" />
      </svg>
    ),
  },
  {
    href: "#content",
    label: "コンテンツ管理",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="2" y="3" width="16" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6 8h8M6 11.5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    children: [
      {
        href: "/admin/events",
        label: "イベント",
        icon: (
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10 6v4.5l3 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      },
      {
        href: "/admin/games",
        label: "ゲーム",
        icon: (
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
            <path d="M10 2.5l2.2 4.4 4.8.7-3.5 3.4.8 4.8-4.3-2.3-4.3 2.3.8-4.8L3 7.6l4.8-.7L10 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        ),
      },
      {
        href: "/admin/news",
        label: "ニュース",
        icon: (
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
            <rect x="2" y="3" width="16" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M6 8h8M6 11.5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ),
      },
    ],
  },
  {
    href: "/admin/admin-users",
    label: "管理者設定",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 1.5v2M10 16.5v2M18.5 10h-2M3.5 10h-2M16 4l-1.4 1.4M5.4 14.6L4 16M16 16l-1.4-1.4M5.4 5.4L4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  const isLoginPage = pathname === "/admin/login";

  /* 折りたたみセクションの子ページなら自動展開 */
  useEffect(() => {
    const contentPaths = ["/admin/events", "/admin/games", "/admin/news"];
    if (contentPaths.some((p) => pathname.startsWith(p))) {
      setOpenSections((prev) => ({ ...prev, "#content": true }));
    }
  }, [pathname]);

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
      <div className="min-h-screen flex items-center justify-center bg-[#F5F6F8]">
        <div className="w-8 h-8 border-2 border-[#1a1a2e] border-t-transparent rounded-full animate-spin" />
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

  function isActive(item: NavItem | { href: string; exact?: boolean }) {
    if ("exact" in item && item.exact) return pathname === item.href;
    return pathname.startsWith(item.href);
  }

  function isSectionChildActive(item: NavItem) {
    return item.children?.some((child) => pathname.startsWith(child.href)) ?? false;
  }

  return (
    <div className="min-h-screen bg-[#F5F6F8] flex">
      {/* モバイルオーバーレイ */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── サイドバー ── */}
      <aside
        className={`fixed md:sticky top-0 left-0 h-screen z-50 shrink-0 transition-transform duration-300 md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex flex-col h-full w-[240px] bg-[#1a1a2e] text-white">
          {/* ロゴ */}
          <div className="px-5 py-5 border-b border-white/10">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <rect x="2" y="2" width="6" height="6" rx="1.5" fill="white" opacity="0.9" />
                  <rect x="10" y="2" width="6" height="6" rx="1.5" fill="white" opacity="0.5" />
                  <rect x="2" y="10" width="6" height="6" rx="1.5" fill="white" opacity="0.5" />
                  <rect x="10" y="10" width="6" height="6" rx="1.5" fill="white" opacity="0.3" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-bold tracking-wide">EIGHT BASE</p>
                <p className="text-[10px] text-white/40 tracking-widest">UNGA</p>
              </div>
            </div>
          </div>

          {/* ナビ */}
          <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
            {NAV_ITEMS.map((item) => {
              if (item.children) {
                /* 折りたたみセクション */
                const childActive = isSectionChildActive(item);
                const sectionKey = item.href;
                const isOpen = openSections[sectionKey] ?? false;
                return (
                  <div key={item.label}>
                    <button
                      onClick={() => setOpenSections((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }))}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150
                        ${childActive ? "text-white bg-white/10" : "text-white/50 hover:text-white hover:bg-white/5"}
                      `}
                    >
                      <span className="shrink-0 w-5 flex justify-center">{item.icon}</span>
                      <span className="flex-1 text-left">{item.label}</span>
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="none"
                        className={`shrink-0 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
                      >
                        <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    {isOpen && (
                      <div className="ml-4 mt-1 space-y-0.5 border-l border-white/10 pl-3">
                        {item.children.map((child) => {
                          const active = pathname.startsWith(child.href);
                          return (
                            <Link
                              key={child.href}
                              href={child.href}
                              onClick={() => setSidebarOpen(false)}
                              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-all duration-150
                                ${active
                                  ? "text-white bg-white/10 font-medium"
                                  : "text-white/40 hover:text-white hover:bg-white/5"
                                }
                              `}
                            >
                              <span className="shrink-0 w-4 flex justify-center">{child.icon}</span>
                              {child.label}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              /* 通常リンク */
              const active = isActive(item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150
                    ${active
                      ? "text-white bg-white/15"
                      : "text-white/50 hover:text-white hover:bg-white/5"
                    }
                  `}
                >
                  <span className="shrink-0 w-5 flex justify-center">{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* 下部メニュー */}
          <div className="px-3 py-4 border-t border-white/10 space-y-1">
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-white/40 hover:text-red-400 hover:bg-red-500/10 transition-all duration-150"
            >
              <span className="shrink-0 w-5 flex justify-center">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M8 3H5a2 2 0 00-2 2v10a2 2 0 002 2h3M13.5 13.5L17 10l-3.5-3.5M17 10H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              ログアウト
            </button>
          </div>
        </div>
      </aside>

      {/* ── メインコンテンツ ── */}
      <main className="flex-1 overflow-auto min-h-screen">
        {/* モバイルヘッダー */}
        <div className="md:hidden sticky top-0 z-30 px-4 py-3 bg-white border-b border-gray-200">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-[#1a1a2e]"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            <p className="text-xs font-bold text-[#1a1a2e] tracking-wider">EIGHT BASE UNGA</p>
            <div className="w-9" />
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
