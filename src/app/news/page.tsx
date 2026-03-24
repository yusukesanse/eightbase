"use client";

import { useState, useEffect } from "react";
import { TopBar } from "@/components/ui/TopBar";
import type { NewsItem, NewsCategory } from "@/types";
import clsx from "clsx";
import dayjs from "dayjs";
import "dayjs/locale/ja";
dayjs.locale("ja");

const CATEGORY_CONFIG: Record<NewsCategory, { bg: string; text: string; dotColor: string; label: string }> = {
  important: { bg: "bg-red-50",  text: "text-red-700",  dotColor: "bg-red-400",  label: "重要" },
  info:      { bg: "bg-blue-50", text: "text-blue-700", dotColor: "bg-[#06C755]", label: "お知らせ" },
  facility:  { bg: "bg-blue-50", text: "text-blue-700", dotColor: "bg-[#06C755]", label: "施設" },
  community: { bg: "bg-gray-100",text: "text-gray-500", dotColor: "bg-gray-400",  label: "コミュニティ" },
};

export default function NewsPage() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/news")
      .then((r) => r.json())
      .then((d) => setNews(d.news ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <TopBar title="ニュース" subtitle="EIGHT CANAL BASE からのお知らせ" color="bg-[#185FA5]" />

      <div className="p-3 space-y-3">
        {loading ? (
          <div className="text-center py-8 text-sm text-gray-400">読み込み中...</div>
        ) : news.length === 0 ? (
          <div className="text-center py-12 text-sm text-gray-400">お知らせはありません</div>
        ) : (
          <>
            <p className="text-xs font-medium text-gray-400">最新のお知らせ</p>
            {news.map((item) => (
              <NewsCard key={item.newsId} item={item} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function NewsCard({ item }: { item: NewsItem }) {
  const [open, setOpen] = useState(false);
  const cfg = CATEGORY_CONFIG[item.category] ?? CATEGORY_CONFIG.info;
  const dateLabel = dayjs(item.publishedAt).format("YYYY年M月D日");

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3 flex gap-2.5">
      <div className={clsx("w-2 h-2 rounded-full flex-shrink-0 mt-1.5", cfg.dotColor)} />
      <div className="flex-1 min-w-0">
        <span className={clsx("text-[10px] px-2 py-0.5 rounded-full font-medium", cfg.bg, cfg.text)}>
          {cfg.label}
        </span>
        <h3 className="text-sm font-medium text-gray-800 mt-1.5 leading-snug">
          {item.title}
        </h3>
        <p className="text-[10px] text-gray-400 mt-0.5">{dateLabel}</p>

        {open && (
          <p className="text-xs text-gray-500 mt-2 leading-relaxed border-t border-gray-100 pt-2 whitespace-pre-wrap">
            {item.body}
          </p>
        )}

        <button
          onClick={() => setOpen((o) => !o)}
          className="text-xs text-[#06C755] mt-1.5"
        >
          {open ? "▲ 閉じる" : "▼ 続きを読む"}
        </button>
      </div>
    </div>
  );
}
