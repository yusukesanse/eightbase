"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const MENUS = [
  {
    href: "/reservation",
    label: "予約",
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <rect x="2" y="3" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M7 2v2M15 2v2M2 9h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    href: "/info",
    label: "Info",
    match: ["/info", "/events", "/news", "/games"],
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <circle cx="11" cy="11" r="9" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M11 10v5M11 7.5v0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    href: "/members",
    label: "メンバー",
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M8 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7z" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M1 19c0-3.5 3-6 7-6s7 2.5 7 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M15 3.5a3.5 3.5 0 010 6.5M17 13c2.5.5 4 2.5 4 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    href: "/timeline",
    label: "掲示板",
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M3 4h16a1 1 0 011 1v10a1 1 0 01-1 1H6l-3 3V5a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        <path d="M7 9h8M7 12h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    href: "/mypage",
    label: "マイページ",
    match: ["/mypage", "/profile"],
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M11 3a4 4 0 014 4v0a4 4 0 01-4 4v0a4 4 0 01-4-4v0a4 4 0 014-4z" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3 19c0-3.5 3.134-6.5 8-6.5s8 3 8 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
];

export function RichMenu() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white border-t border-gray-200 grid grid-cols-5 z-50">
      {MENUS.map((menu) => {
        const paths = (menu as { match?: string[] }).match || [menu.href];
        const active = paths.some((p) => pathname.startsWith(p));
        return (
          <Link
            key={menu.href}
            href={menu.href}
            className={clsx(
              "flex flex-col items-center justify-center py-2 gap-1 text-xs transition-colors",
              active
                ? "text-[#A5C1C8] font-medium"
                : "text-gray-400 hover:text-gray-600"
            )}
          >
            <span
              className={clsx(
                "transition-colors",
                active ? "text-[#A5C1C8]" : "text-gray-400"
              )}
            >
              {menu.icon}
            </span>
            {menu.label}
          </Link>
        );
      })}
    </nav>
  );
}
