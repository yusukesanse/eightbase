"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const MENUS = [
  {
    href: "/reservation",
    label: "施設予約",
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <rect x="2" y="3" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M7 2v2M15 2v2M2 9h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    href: "/events",
    label: "イベント",
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M11 2l2 6h6.5l-5.5 4 2 6L11 14 5.5 18l2-6L2 8h6.5L11 2z"
          stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    href: "/quests",
    label: "クエスト",
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M11 7v4l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    href: "/news",
    label: "ニュース",
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M4 5h14M4 10h10M4 15h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
];

export function RichMenu() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white border-t border-gray-200 grid grid-cols-4 z-50">
      {MENUS.map((menu) => {
        const active = pathname.startsWith(menu.href);
        return (
          <Link
            key={menu.href}
            href={menu.href}
            className={clsx(
              "flex flex-col items-center justify-center py-2 gap-1 text-xs transition-colors",
              active
                ? "text-[#06C755] font-medium"
                : "text-gray-400 hover:text-gray-600"
            )}
          >
            <span
              className={clsx(
                "transition-colors",
                active ? "text-[#06C755]" : "text-gray-400"
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
