"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { RichText } from "@/components/ui/RichText";
import type { NewsItem, NewsCategory } from "@/types";
import dayjs from "dayjs";
import "dayjs/locale/ja";
dayjs.locale("ja");

const CATEGORY_CONFIG: Record<NewsCategory, { bg: string; text: string; label: string }> = {
  info:      { bg: "bg-[#A5C1C8]/20", text: "text-[#231714]", label: "お知らせ" },
  facility:  { bg: "bg-[#B0E401]/10", text: "text-[#231714]", label: "施設" },
  community: { bg: "bg-gray-100",     text: "text-[#231714]", label: "コミュニティ" },
};

export default function NewsDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [item, setItem] = useState<NewsItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/news");
        const d = await res.json();
        const found = (d.news ?? []).find((n: NewsItem) => n.newsId === id);
        if (found) setItem(found);
      } finally { setLoading(false); }
    })();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-[#A5C1C8] rounded-full animate-spin" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-3">
        <p className="text-gray-400 text-sm">ニュースが見つかりません</p>
        <button onClick={() => router.back()} className="text-sm text-[#A5C1C8]">戻る</button>
      </div>
    );
  }

  const cfg = CATEGORY_CONFIG[item.category] ?? CATEGORY_CONFIG.info;

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      {/* ヘッダー画像 / カラーヒーロー */}
      <div className="relative">
        {item.imageUrl ? (
          <div className="aspect-[16/9] w-full overflow-hidden bg-gray-100">
            <img src={item.imageUrl} alt={item.title} className="w-full h-full object-cover" />
          </div>
        ) : (
          <div className="aspect-[16/9] w-full bg-gradient-to-br from-[#A5C1C8] to-[#8BA8AF] flex items-center justify-center">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" opacity="0.5">
              <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
              <path d="M18 14h-8M15 18h-5M10 6h8v4h-8V6Z" />
            </svg>
          </div>
        )}

        <button
          onClick={() => router.back()}
          className="absolute top-3 left-3 w-9 h-9 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
      </div>

      {/* コンテンツ */}
      <div className="relative -mt-5 bg-white rounded-t-2xl px-5 pt-6 pb-24">
        {/* カテゴリバッジ */}
        <span className={`inline-block text-[11px] px-3 py-1 rounded-full font-medium ${cfg.bg} ${cfg.text}`}>
          {cfg.label}
        </span>

        <h1 className="text-xl font-bold text-[#231714] mt-3 leading-tight">
          {item.title}
        </h1>

        <p className="text-xs text-gray-400 mt-2">
          {dayjs(item.publishedAt).format("YYYY年M月D日（ddd）")}
        </p>

        {/* 区切り */}
        <hr className="my-5 border-gray-100" />

        {/* 本文 */}
        <RichText
          text={item.body}
          className="text-sm text-gray-700 leading-relaxed"
        />
      </div>
    </div>
  );
}
