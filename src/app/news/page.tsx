"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/ui/TopBar";
import type { NewsItem, NewsCategory } from "@/types";
import clsx from "clsx";
import dayjs from "dayjs";
import "dayjs/locale/ja";
dayjs.locale("ja");

const CATEGORY_CONFIG: Record<NewsCategory, { bg: string; text: string; dot: string; label: string }> = {
  important: { bg: "bg-red-50",   text: "text-red-700",  dot: "bg-red-500",    label: "重要" },
  info:      { bg: "bg-blue-50",  text: "text-blue-700", dot: "bg-blue-500",   label: "お知らせ" },
  facility:  { bg: "bg-teal-50",  text: "text-teal-700", dot: "bg-teal-500",   label: "施設" },
  community: { bg: "bg-gray-100", text: "text-gray-600", dot: "bg-gray-400",   label: "コミュニティ" },
};

export default function NewsPage() {
  const router = useRouter();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/news")
      .then(r => r.json())
      .then(d => setNews(d.news ?? []))
      .finally(() => setLoading(false));
  }, []);

  const today = dayjs().format("M月D日（ddd）");
  const featured = news[0];
  const topStories = news.slice(1, 3);
  const rest = news.slice(3);

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <TopBar title="ニュース" subtitle="EIGHT BASE UNGA からのお知らせ" color="bg-[#185FA5]" />

      <div className="p-4">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-gray-200 border-t-[#185FA5] rounded-full animate-spin" />
          </div>
        ) : news.length === 0 ? (
          <div className="text-center py-16 text-sm text-gray-400">お知らせはありません</div>
        ) : (
          <div className="space-y-5">
            {/* 日付ヘッダー */}
            <div>
              <p className="text-[11px] text-gray-400 font-medium">{today}</p>
              <h2 className="text-lg font-black text-gray-900 mt-0.5">Breaking News</h2>
            </div>

            {/* Featured (大カード) */}
            {featured && (
              <FeaturedNewsCard item={featured} onClick={() => router.push(`/news/${featured.newsId}`)} />
            )}

            {/* Top Stories 横スクロール */}
            {topStories.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Top Stories</h3>
                <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide">
                  {topStories.map(item => (
                    <TopStoryCard key={item.newsId} item={item} onClick={() => router.push(`/news/${item.newsId}`)} />
                  ))}
                </div>
              </div>
            )}

            {/* 残りのニュース */}
            {rest.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Recent</h3>
                <div className="space-y-3">
                  {rest.map(item => (
                    <CompactNewsCard key={item.newsId} item={item} onClick={() => router.push(`/news/${item.newsId}`)} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Featured 大カード ─── */
function FeaturedNewsCard({ item, onClick }: { item: NewsItem; onClick: () => void }) {
  const cfg = CATEGORY_CONFIG[item.category] ?? CATEGORY_CONFIG.info;

  return (
    <div onClick={onClick} className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100 active:scale-[0.98] transition-transform cursor-pointer">
      {item.imageUrl ? (
        <div className="aspect-[16/9] overflow-hidden bg-gray-100">
          <img src={item.imageUrl} alt={item.title} className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className="aspect-[16/9] bg-gradient-to-br from-[#185FA5] to-blue-700 flex items-end p-5">
          <span className="text-white/60 text-xs font-medium">EIGHT BASE UNGA</span>
        </div>
      )}
      <div className="p-4">
        <span className={clsx("text-[10px] px-2 py-0.5 rounded-full font-bold", cfg.bg, cfg.text)}>
          {cfg.label}
        </span>
        <h3 className="text-base font-bold text-gray-900 mt-2 leading-snug line-clamp-2">
          {item.title}
        </h3>
        <p className="text-xs text-gray-500 mt-1 line-clamp-2">{item.body}</p>
        <p className="text-[10px] text-gray-400 mt-2">
          {dayjs(item.publishedAt).format("YYYY年M月D日")}
        </p>
      </div>
    </div>
  );
}

/* ─── Top Story カード (横スクロール用) ─── */
function TopStoryCard({ item, onClick }: { item: NewsItem; onClick: () => void }) {
  const cfg = CATEGORY_CONFIG[item.category] ?? CATEGORY_CONFIG.info;

  return (
    <div onClick={onClick} className="flex-shrink-0 w-44 bg-white rounded-xl overflow-hidden shadow-sm border border-gray-100 active:scale-[0.97] transition-transform cursor-pointer">
      {item.imageUrl ? (
        <div className="aspect-[4/3] overflow-hidden bg-gray-100">
          <img src={item.imageUrl} alt={item.title} className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className="aspect-[4/3] bg-gradient-to-br from-[#185FA5] to-indigo-600" />
      )}
      <div className="p-2.5">
        <span className={clsx("text-[9px] px-1.5 py-0.5 rounded font-bold", cfg.bg, cfg.text)}>
          {cfg.label}
        </span>
        <h3 className="text-xs font-bold text-gray-900 mt-1 leading-snug line-clamp-3">
          {item.title}
        </h3>
        <p className="text-[10px] text-gray-400 mt-1">
          {dayjs(item.publishedAt).format("M月D日")}
        </p>
      </div>
    </div>
  );
}

/* ─── Compact カード ─── */
function CompactNewsCard({ item, onClick }: { item: NewsItem; onClick: () => void }) {
  const cfg = CATEGORY_CONFIG[item.category] ?? CATEGORY_CONFIG.info;

  return (
    <div onClick={onClick} className="bg-white rounded-xl overflow-hidden shadow-sm border border-gray-100 flex active:scale-[0.98] transition-transform cursor-pointer">
      {item.imageUrl ? (
        <div className="w-24 flex-shrink-0 overflow-hidden bg-gray-100">
          <img src={item.imageUrl} alt={item.title} className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className="w-24 flex-shrink-0 bg-gradient-to-br from-[#185FA5] to-blue-700 flex items-center justify-center">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" opacity="0.5">
            <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
            <path d="M18 14h-8M15 18h-5M10 6h8v4h-8V6Z" />
          </svg>
        </div>
      )}
      <div className="flex-1 p-3 min-w-0">
        <div className="flex items-center gap-2">
          <div className={clsx("w-1.5 h-1.5 rounded-full", cfg.dot)} />
          <span className={clsx("text-[10px] font-bold", cfg.text)}>{cfg.label}</span>
        </div>
        <h3 className="text-sm font-bold text-gray-900 mt-1 leading-snug line-clamp-2">
          {item.title}
        </h3>
        <p className="text-[10px] text-gray-400 mt-1">
          {dayjs(item.publishedAt).format("M月D日")}
        </p>
      </div>
    </div>
  );
}
