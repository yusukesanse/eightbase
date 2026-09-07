"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { RichText } from "@/components/ui/RichText";
import type { NewsItem, NewsCategory } from "@/types";
import { PageBg, StatusPill, type EbStatusTone } from "@/components/ui/eb";
import dayjs from "dayjs";
import "dayjs/locale/ja";
dayjs.locale("ja");

const CATEGORY_CONFIG: Record<NewsCategory, { tone: EbStatusTone; label: string }> = {
  info:      { tone: "muted", label: "お知らせ" },
  facility:  { tone: "green", label: "施設" },
  community: { tone: "gold",  label: "コミュニティ" },
};

export default function NewsDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [item, setItem] = useState<NewsItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        // 一覧APIから探さず単体取得（limit に依存しない）
        const res = await fetch(`/api/news/${id}`, {
          credentials: "include",
          cache: "no-store",
        });
        if (res.ok) setItem(await res.json());
      } finally { setLoading(false); }
    })();
  }, [id]);

  if (loading) {
    return (
      <PageBg className="flex items-center justify-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
          style={{ borderColor: "var(--eb-green)", borderTopColor: "transparent" }}
        />
      </PageBg>
    );
  }

  if (!item) {
    return (
      <PageBg className="flex flex-col items-center justify-center gap-3">
        <p className="text-[15px] text-[color:var(--eb-ink-muted)]">ニュースが見つかりません</p>
        <button onClick={() => router.back()} className="text-[15px] font-bold text-[color:var(--eb-green-text)]">
          戻る
        </button>
      </PageBg>
    );
  }

  const cfg = CATEGORY_CONFIG[item.category] ?? CATEGORY_CONFIG.info;

  return (
    <PageBg>
      {/* ヘッダー画像 / カラーヒーロー */}
      <div className="relative">
        {item.imageUrl ? (
          <div className="aspect-[16/9] w-full overflow-hidden bg-[color:var(--eb-tint)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.imageUrl} alt={item.title} className="h-full w-full object-cover" />
          </div>
        ) : (
          <div
            className="flex aspect-[16/9] w-full items-center justify-center"
            style={{ background: "linear-gradient(135deg, rgba(35,147,94,.24), rgba(35,147,94,.06))" }}
          >
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--eb-green-text)" strokeWidth="1.5" opacity="0.6">
              <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
              <path d="M18 14h-8M15 18h-5M10 6h8v4h-8V6Z" />
            </svg>
          </div>
        )}

        <button
          onClick={() => router.back()}
          className="absolute left-3 top-3 flex h-9 w-9 items-center justify-center rounded-full backdrop-blur-sm"
          style={{ background: "rgba(0,0,0,.32)" }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
      </div>

      {/* コンテンツ */}
      <div className="relative -mt-5 rounded-t-[28px] px-5 pb-24 pt-6" style={{ background: "var(--eb-bg)" }}>
        {/* カテゴリバッジ */}
        <StatusPill tone={cfg.tone}>{cfg.label}</StatusPill>

        <h1 className="mt-3 text-[22px] font-bold leading-tight text-[color:var(--eb-ink)]">
          {item.title}
        </h1>

        <p className="mt-2 text-[13px] text-[color:var(--eb-ink-muted)]">
          {dayjs(item.publishedAt).format("YYYY年M月D日（ddd）")}
        </p>

        {/* 区切り */}
        <hr className="my-5 border-[color:var(--eb-line)]" />

        {/* 本文 */}
        <RichText
          text={item.body}
          className="text-[15px] leading-[1.7] text-[color:var(--eb-ink)]"
        />
      </div>
    </PageBg>
  );
}
