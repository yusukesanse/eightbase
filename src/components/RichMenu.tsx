"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { isGamesOnlyRole, normalizeRole, type UserRole } from "@/lib/roles";

/** ゲスト用の簡易ナビ（ゲーム機能のみ・全ゲームのハブ=/games）。 */
const GUEST_MENUS = [
  {
    href: "/games",
    label: "ゲーム",
    match: ["/games"],
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M4.31802 20.5355C5.63604 22 7.75736 22 12 22C16.2426 22 18.364 22 19.682 20.5355C21 19.0711 21 16.714 21 12C21 7.28595 21 4.92893 19.682 3.46447C18.364 2 16.2426 2 12 2C7.75736 2 5.63604 2 4.31802 3.46447C3 4.92893 3 7.28595 3 12C3 16.714 3 19.0711 4.31802 20.5355Z" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 8C7 7.53501 7 7.30252 7.05111 7.11177C7.18981 6.59413 7.59413 6.18981 8.11177 6.05111C8.30252 6 8.53501 6 9 6H15C15.465 6 15.6975 6 15.8882 6.05111C16.4059 6.18981 16.8102 6.59413 16.9489 7.11177C17 7.30252 17 7.53501 17 8C17 8.46499 17 8.69748 16.9489 8.88823C16.8102 9.40587 16.4059 9.81019 15.8882 9.94889C15.6975 10 15.465 10 15 10H9C8.53501 10 8.30252 10 8.11177 9.94889C7.59413 9.81019 7.18981 9.40587 7.05111 8.88823C7 8.69748 7 8.46499 7 8Z" stroke="currentColor" strokeWidth="1.5" />
        <path opacity="0.5" d="M8.5 14V17M7 15.5L10 15.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <g opacity="0.5" fill="currentColor">
          <path d="M16.3333 13.8333C16.3333 14.2936 15.9602 14.6667 15.5 14.6667C15.0398 14.6667 14.6667 14.2936 14.6667 13.8333C14.6667 13.3731 15.0398 13 15.5 13C15.9602 13 16.3333 13.3731 16.3333 13.8333Z" />
          <path d="M16.3333 17.1667C16.3333 17.6269 15.9602 18 15.5 18C15.0398 18 14.6667 17.6269 14.6667 17.1667C14.6667 16.7064 15.0398 16.3333 15.5 16.3333C15.9602 16.3333 16.3333 16.7064 16.3333 17.1667Z" />
          <path d="M14.6667 15.5C14.6667 15.9602 14.2936 16.3333 13.8333 16.3333C13.3731 16.3333 13 15.9602 13 15.5C13 15.0398 13.3731 14.6667 13.8333 14.6667C14.2936 14.6667 14.6667 15.0398 14.6667 15.5Z" />
          <path d="M18 15.5C18 15.9602 17.6269 16.3333 17.1667 16.3333C16.7064 16.3333 16.3333 15.9602 16.3333 15.5C16.3333 15.0398 16.7064 14.6667 17.1667 14.6667C17.6269 14.6667 18 15.0398 18 15.5Z" />
        </g>
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
    match: ["/info", "/events", "/news", "/timeline"],
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
    href: "/games",
    label: "ゲーム",
    match: ["/games"],
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M4.31802 20.5355C5.63604 22 7.75736 22 12 22C16.2426 22 18.364 22 19.682 20.5355C21 19.0711 21 16.714 21 12C21 7.28595 21 4.92893 19.682 3.46447C18.364 2 16.2426 2 12 2C7.75736 2 5.63604 2 4.31802 3.46447C3 4.92893 3 7.28595 3 12C3 16.714 3 19.0711 4.31802 20.5355Z" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 8C7 7.53501 7 7.30252 7.05111 7.11177C7.18981 6.59413 7.59413 6.18981 8.11177 6.05111C8.30252 6 8.53501 6 9 6H15C15.465 6 15.6975 6 15.8882 6.05111C16.4059 6.18981 16.8102 6.59413 16.9489 7.11177C17 7.30252 17 7.53501 17 8C17 8.46499 17 8.69748 16.9489 8.88823C16.8102 9.40587 16.4059 9.81019 15.8882 9.94889C15.6975 10 15.465 10 15 10H9C8.53501 10 8.30252 10 8.11177 9.94889C7.59413 9.81019 7.18981 9.40587 7.05111 8.88823C7 8.69748 7 8.46499 7 8Z" stroke="currentColor" strokeWidth="1.5" />
        <path opacity="0.5" d="M8.5 14V17M7 15.5L10 15.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <g opacity="0.5" fill="currentColor">
          <path d="M16.3333 13.8333C16.3333 14.2936 15.9602 14.6667 15.5 14.6667C15.0398 14.6667 14.6667 14.2936 14.6667 13.8333C14.6667 13.3731 15.0398 13 15.5 13C15.9602 13 16.3333 13.3731 16.3333 13.8333Z" />
          <path d="M16.3333 17.1667C16.3333 17.6269 15.9602 18 15.5 18C15.0398 18 14.6667 17.6269 14.6667 17.1667C14.6667 16.7064 15.0398 16.3333 15.5 16.3333C15.9602 16.3333 16.3333 16.7064 16.3333 17.1667Z" />
          <path d="M14.6667 15.5C14.6667 15.9602 14.2936 16.3333 13.8333 16.3333C13.3731 16.3333 13 15.9602 13 15.5C13 15.0398 13.3731 14.6667 13.8333 14.6667C14.2936 14.6667 14.6667 15.0398 14.6667 15.5Z" />
          <path d="M18 15.5C18 15.9602 17.6269 16.3333 17.1667 16.3333C16.7064 16.3333 16.3333 15.9602 16.3333 15.5C16.3333 15.0398 16.7064 14.6667 17.1667 14.6667C17.6269 14.6667 18 15.0398 18 15.5Z" />
        </g>
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
            aria-current={active ? "page" : undefined}
            className={clsx(
              "relative flex flex-col items-center justify-center py-2 gap-1 text-xs transition-colors",
              active
                ? "text-[#33636e] font-bold"
                : "text-gray-700 hover:text-gray-700"
            )}
          >
            {/* 「今ここ」を色だけに頼らず、上部インジケーターバー＋淡いアクセント地でも示す（色弱配慮） */}
            {active && (
              <>
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[3px] rounded-full bg-[#33636e]" />
                <span className="absolute inset-x-1 inset-y-0.5 rounded-xl bg-[#33636e]/[0.08]" />
              </>
            )}
            <span
              className={clsx(
                "relative z-10 transition-colors",
                active ? "text-[#33636e]" : "text-gray-700"
              )}
            >
              {menu.icon}
            </span>
            <span className="relative z-10">{menu.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
