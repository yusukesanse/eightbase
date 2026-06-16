"use client";

import { useEffect, useState } from "react";
import { useParams, usePathname } from "next/navigation";
import Link from "next/link";
import type { Season } from "@/types";

export default function SeasonDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { seasonId } = useParams<{ seasonId: string }>();
  const pathname = usePathname();
  const [season, setSeason] = useState<Season | null>(null);

  useEffect(() => {
    fetch("/api/admin/scoreboard/seasons", { credentials: "same-origin" })
      .then((res) => res.json())
      .then((data) => {
        const found = (data.seasons ?? []).find((s: Season) => s.seasonId === seasonId);
        if (found) setSeason(found);
      })
      .catch(() => {});
  }, [seasonId]);

  const TABS = [
    { href: `/admin/games/seasons/${seasonId}`, label: "概要", exact: true },
    { href: `/admin/games/seasons/${seasonId}/mahjong`, label: "麻雀リーグ" },
    { href: `/admin/games/seasons/${seasonId}/matching`, label: "卓組み" },
    { href: `/admin/games/seasons/${seasonId}/mahjong-cs`, label: "麻雀CS" },
    { href: `/admin/games/seasons/${seasonId}/scores`, label: "スコア入力" },
    { href: `/admin/games/seasons/${seasonId}/rankings`, label: "ランキング" },
    { href: `/admin/games/seasons/${seasonId}/cs`, label: "CS管理" },
  ];

  const isActive = (tab: (typeof TABS)[number]) =>
    tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);

  return (
    <div>
      {/* ヘッダー */}
      <div className="px-4 pt-4 pb-2">
        <Link
          href="/admin/games/seasons"
          className="inline-flex items-center text-sm text-[#231714]/50 hover:text-[#231714]/80 transition-colors"
        >
          ← シーズン一覧
        </Link>

        <div className="mt-2 flex items-center justify-between">
          <h1 className="text-xl font-bold text-[#231714]">
            {season?.name ?? "読み込み中..."}
          </h1>
          {season && (
            <span
              className={`
                inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium
                ${
                  season.active
                    ? "bg-[#B0E401]/20 text-[#231714]"
                    : "bg-[#231714]/5 text-[#231714]/40"
                }
              `}
            >
              {season.active ? "有効" : "無効"}
            </span>
          )}
        </div>
      </div>

      {/* タブナビゲーション */}
      <div className="border-b border-[#231714]/10 bg-white/60 backdrop-blur-sm sticky top-0 z-10">
        <nav
          className="flex gap-0 overflow-x-auto px-1"
          aria-label="シーズン詳細タブ"
        >
          {TABS.map((tab) => {
            const active = isActive(tab);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`
                  relative px-5 py-3 text-sm font-medium whitespace-nowrap transition-colors
                  ${
                    active
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
