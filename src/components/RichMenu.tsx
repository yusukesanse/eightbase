"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { isGamesOnlyRole, normalizeRole, type UserRole } from "@/lib/roles";

/** ゲスト用の簡易ナビ（ゲーム機能のみ・全ゲームのハブ=/info ゲームタブ）。 */
const GUEST_MENUS = [
  {
    href: "/info",
    label: "ゲーム",
    match: ["/info", "/games"],
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <rect x="4" y="2" width="14" height="18" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 6h6M8 9.5h6M8 13h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
];

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
  const [role, setRole] = useState<UserRole>("member");

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/check", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (alive && d.authorized) setRole(normalizeRole(d.role));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // ゲスト・エイト社員はゲーム系のみ（1列メニュー）
  const gamesOnly = isGamesOnlyRole(role);
  const menus = gamesOnly ? GUEST_MENUS : MENUS;
  const cols = gamesOnly ? "grid-cols-1" : "grid-cols-5";

  return (
    <nav className={clsx("fixed bottom-0 left-0 right-0 max-w-4xl mx-auto bg-white border-t border-gray-200 grid z-50", cols)}>
      {menus.map((menu) => {
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
