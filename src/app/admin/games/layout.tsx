"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

const TABS = [
  { href: "/admin/games/seasons", label: "シーズン", exact: false },
];

export default function GamesLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const isActive = (tab: (typeof TABS)[number]) =>
    tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);

  return (
    <div>
      {/* タブナビゲーション */}
      <div className="border-b border-[#231714]/10 bg-white/60 backdrop-blur-sm sticky top-0 z-10">
        <nav className="flex gap-0 overflow-x-auto px-1" aria-label="ゲーム管理タブ">
          {TABS.map((tab) => {
            const active = isActive(tab);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`
                  relative px-5 py-3 text-sm font-medium whitespace-nowrap transition-colors
                  ${active
                    ? "text-[#231714]"
                    : "text-[#231714]/40 hover:text-[#231714]/70"
                  }
                `}
              >
                {tab.label}
                {active && (
                  <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-[#A5C1C8] rounded-full" />
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* タブコンテンツ */}
      <div>{children}</div>
    </div>
  );
}
