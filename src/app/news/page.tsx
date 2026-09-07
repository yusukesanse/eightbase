"use client";

import { useRouter } from "next/navigation";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import type { NewsItem, NewsCategory, NewsPriority } from "@/types";
import { GlassCard, PageBg, PageHeading, StatusPill, type EbStatusTone } from "@/components/ui/eb";
import dayjs from "dayjs";
import "dayjs/locale/ja";
dayjs.locale("ja");

const CATEGORY_CONFIG: Record<NewsCategory, { tone: EbStatusTone; label: string }> = {
  info:      { tone: "muted", label: "お知らせ" },
  facility:  { tone: "green", label: "施設" },
  community: { tone: "gold",  label: "コミュニティ" },
};

export default function NewsPage() {
  const router = useRouter();
  // 前回表示を即出し→裏で再取得（数分キャッシュ）。info ページとキーを共有する。
  const { data, isLoading } = useStaleWhileRevalidate<{ news: NewsItem[] }>(
    "news:list",
    () =>
      fetch("/api/news", { credentials: "include", cache: "no-store" }).then(
        (r) => r.json()
      )
  );
  const news = data?.news ?? [];
  // フルスクリーンスピナーは初回（キャッシュ無し）のみ
  const loading = isLoading;

  const today = dayjs().format("M月D日（ddd）");

  // priority に基づいてセクション分け
  const newsWithPriority = news.map(n => ({
    ...n,
    priority: ((n as unknown as Record<string, unknown>).priority as NewsPriority) ?? "normal",
  }));
  const highItems   = newsWithPriority.filter(n => n.priority === "high");
  const mediumItems = newsWithPriority.filter(n => n.priority === "medium");
  const normalItems = newsWithPriority.filter(n => n.priority === "normal");

  // Breaking News: high の最新1件
  const featured = highItems[0] ?? null;
  // Top Stories: high の残り + medium 全件
  const topStories = [...highItems.slice(1), ...mediumItems];
  // Recent: normal 全件
  const rest = normalItems;

  return (
    <PageBg>
      <div className="px-5 pt-[52px]">
        <PageHeading title="ニュース" subtitle="EIGHT BASE UNGA からのお知らせ" />
      </div>

      <div className="px-5 pt-5 pb-10">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div
              className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
              style={{ borderColor: "var(--eb-green)", borderTopColor: "transparent" }}
            />
          </div>
        ) : news.length === 0 ? (
          <GlassCard>
            <p className="py-6 text-center text-[15px] text-[color:var(--eb-ink-muted)]">お知らせはありません</p>
          </GlassCard>
        ) : (
          <div className="flex flex-col gap-5">
            {/* 日付ヘッダー */}
            <div>
              <p className="text-[12px] font-medium text-[color:var(--eb-ink-muted)]">{today}</p>
              <h2 className="mt-0.5 text-[19px] font-bold text-[color:var(--eb-ink)]">Breaking News</h2>
            </div>

            {/* Featured (大カード) */}
            {featured && (
              <FeaturedNewsCard item={featured} onClick={() => router.push(`/news/${featured.newsId}`)} />
            )}

            {/* Top Stories 横スクロール */}
            {topStories.length > 0 && (
              <div>
                <h3 className="mb-2 text-[12px] font-bold uppercase tracking-wider text-[color:var(--eb-ink-muted)]">
                  Top Stories
                </h3>
                <div className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-1">
                  {topStories.map(item => (
                    <TopStoryCard key={item.newsId} item={item} onClick={() => router.push(`/news/${item.newsId}`)} />
                  ))}
                </div>
              </div>
            )}

            {/* 残りのニュース */}
            {rest.length > 0 && (
              <div>
                <h3 className="mb-2 text-[12px] font-bold uppercase tracking-wider text-[color:var(--eb-ink-muted)]">
                  Recent
                </h3>
                <div className="flex flex-col gap-2.5">
                  {rest.map(item => (
                    <CompactNewsCard key={item.newsId} item={item} onClick={() => router.push(`/news/${item.newsId}`)} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </PageBg>
  );
}

/* ─── Featured 大カード ─── */
function FeaturedNewsCard({ item, onClick }: { item: NewsItem; onClick: () => void }) {
  const cfg = CATEGORY_CONFIG[item.category] ?? CATEGORY_CONFIG.info;

  return (
    <div role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => { if (e.key === "Enter") onClick(); }} className="cursor-pointer active:opacity-80">
      <GlassCard className="overflow-hidden !p-0">
        {item.imageUrl ? (
          <div className="aspect-[16/9] overflow-hidden bg-[color:var(--eb-tint)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.imageUrl} alt={item.title} className="h-full w-full object-cover" />
          </div>
        ) : (
          <div
            className="flex aspect-[16/9] items-end p-5"
            style={{ background: "linear-gradient(135deg, rgba(35,147,94,.24), rgba(35,147,94,.06))" }}
          >
            <span className="text-[12px] font-medium text-[color:var(--eb-green-text)]">EIGHT BASE UNGA</span>
          </div>
        )}
        <div className="p-4">
          <StatusPill tone={cfg.tone}>{cfg.label}</StatusPill>
          <h3 className="mt-2 text-[17px] font-bold leading-snug text-[color:var(--eb-ink)] line-clamp-2">
            {item.title}
          </h3>
          <p className="mt-1 text-[13px] text-[color:var(--eb-ink-muted)] line-clamp-2">{item.body}</p>
          <p className="mt-2 text-[12px] text-[color:var(--eb-ink-muted)]">
            {dayjs(item.publishedAt).format("YYYY年M月D日")}
          </p>
        </div>
      </GlassCard>
    </div>
  );
}

/* ─── Top Story カード (横スクロール用) ─── */
function TopStoryCard({ item, onClick }: { item: NewsItem; onClick: () => void }) {
  const cfg = CATEGORY_CONFIG[item.category] ?? CATEGORY_CONFIG.info;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter") onClick(); }}
      className="w-44 shrink-0 cursor-pointer active:opacity-80"
    >
      <GlassCard className="overflow-hidden !p-0">
        {item.imageUrl ? (
          <div className="aspect-[4/3] overflow-hidden bg-[color:var(--eb-tint)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.imageUrl} alt={item.title} className="h-full w-full object-cover" />
          </div>
        ) : (
          <div
            className="aspect-[4/3]"
            style={{ background: "linear-gradient(135deg, rgba(35,147,94,.24), rgba(35,147,94,.06))" }}
          />
        )}
        <div className="p-2.5">
          <StatusPill tone={cfg.tone} className="px-2 py-1 text-[10px]">{cfg.label}</StatusPill>
          <h3 className="mt-1.5 text-[13px] font-bold leading-snug text-[color:var(--eb-ink)] line-clamp-3">
            {item.title}
          </h3>
          <p className="mt-1 text-[11px] text-[color:var(--eb-ink-muted)]">
            {dayjs(item.publishedAt).format("M月D日")}
          </p>
        </div>
      </GlassCard>
    </div>
  );
}

/* ─── Compact カード ─── */
function CompactNewsCard({ item, onClick }: { item: NewsItem; onClick: () => void }) {
  const cfg = CATEGORY_CONFIG[item.category] ?? CATEGORY_CONFIG.info;

  return (
    <div role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => { if (e.key === "Enter") onClick(); }} className="cursor-pointer active:opacity-80">
      <GlassCard padding="md">
        <div className="flex gap-3">
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.imageUrl} alt={item.title} className="h-14 w-14 shrink-0 rounded-xl object-cover" />
          ) : (
            <div
              className="h-14 w-14 shrink-0 rounded-xl"
              style={{ background: "linear-gradient(135deg, rgba(35,147,94,.24), rgba(35,147,94,.06))" }}
            />
          )}
          <div className="min-w-0 flex-1">
            <StatusPill tone={cfg.tone}>{cfg.label}</StatusPill>
            <h3 className="mt-1.5 text-[15px] font-bold leading-snug text-[color:var(--eb-ink)] line-clamp-2">
              {item.title}
            </h3>
            <p className="mt-1 text-[12px] text-[color:var(--eb-ink-muted)]">
              {dayjs(item.publishedAt).format("M月D日")}
            </p>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
