"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import type { NufEvent, NewsItem } from "@/types";
import { TimelineBoard } from "@/components/TimelineBoard";
import { paymentReturnSearch, GAME_PAYMENT_RETURN_BASE } from "@/lib/gamePaymentReturn";
import { GlassCard, PageBg, PageHeading, SegmentedTabs, StatusPill, type EbStatusTone } from "@/components/ui/eb";
import clsx from "clsx";
import dayjs from "dayjs";
import "dayjs/locale/ja";
dayjs.locale("ja");

// E-1: ゲームはボトムバーの独立導線 /games へ移設。Info は イベント / ニュース / 掲示板。
const TABS = [
  { id: "events", label: "イベント" },
  { id: "news", label: "ニュース" },
  { id: "timeline", label: "掲示板" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const EMPTY_EVENTS: (NufEvent & { goodCount: number })[] = [];
const EMPTY_NEWS: NewsItem[] = [];

export default function InfoPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>("events");
  // 参加費 Square 決済の戻りは現在 /games へ直接返している（gamePaymentReturnPath）。
  // ここは **決済リンク発行済み・未確定の古い `/info?...` 戻り**を取りこぼさないための後方互換。
  // ⚠️ 会員は /info に入れるので転送できるが、ゲストは AuthGuard に弾かれてここまで来ない。
  //    ゲストの救済は AuthGuard 側（決済パラメータを引き継いで /games へ送る）が担当する。
  useEffect(() => {
    if (typeof window === "undefined") return;
    const search = paymentReturnSearch(window.location.search);
    if (search) router.replace(`${GAME_PAYMENT_RETURN_BASE}${search}`);
  }, [router]);

  const visibleTabs = TABS;

  // 前回表示を即出し→裏で再取得（数分キャッシュ）。
  // events/news の各ページとキーを共有するのでページ間遷移でも再利用される。
  const { data: eventsData, isLoading: eventsLoading } = useStaleWhileRevalidate<{
    events: (NufEvent & { goodCount: number })[];
  }>("events:list", () =>
    fetch("/api/events", { credentials: "include", cache: "no-store" }).then((r) =>
      r.json()
    )
  );
  const { data: newsData, isLoading: newsLoading } = useStaleWhileRevalidate<{
    news: NewsItem[];
  }>("news:list", () =>
    fetch("/api/news", { credentials: "include", cache: "no-store" }).then((r) =>
      r.json()
    )
  );

  const events = eventsData?.events ?? EMPTY_EVENTS;
  const news = newsData?.news ?? EMPTY_NEWS;
  // フルスクリーンスピナーは初回（両方ともキャッシュ無し）のときだけ
  const loading = eventsLoading && newsLoading;

  return (
    <PageBg>
      <div className="px-5 pt-[52px]">
        <PageHeading title="INFO" subtitle="お知らせ・イベント・掲示板" />
        <div className="mt-4">
          <SegmentedTabs
            items={visibleTabs.map((t) => ({ id: t.id, label: t.label }))}
            value={activeTab}
            onChange={(id) => setActiveTab(id as TabId)}
            size="lg"
          />
        </div>
      </div>

      {/* コンテンツ */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div
            className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
            style={{ borderColor: "var(--eb-green)", borderTopColor: "transparent" }}
          />
        </div>
      ) : (
        <div className="px-5 pt-5 pb-10">
          {activeTab === "events" && (
            <EventsTab events={events} router={router} />
          )}
          {activeTab === "news" && (
            <NewsTab news={news} router={router} />
          )}
          {activeTab === "timeline" && <TimelineBoard embedded />}
        </div>
      )}
    </PageBg>
  );
}

/* ═══════════════════════════════════════════
   イベントタブ（タイムライン型）
   ═══════════════════════════════════════════ */

const EVENT_CATEGORY_LABELS: Record<string, string> = {
  // 新カテゴリ（日本語キー）
  "ワークショップ": "ワークショップ",
  "セミナー": "セミナー",
  "カンファレンス": "カンファレンス",
  "ミートアップ": "ミートアップ",
  "交流会": "交流会",
  // 旧カテゴリ（後方互換）
  networking: "ネットワーキング",
  workshop: "ワークショップ",
  social: "交流",
  info: "お知らせ",
};

const EVENT_CATEGORY_TONES: Record<string, EbStatusTone> = {
  "ワークショップ": "green",
  "セミナー": "gold",
  "カンファレンス": "coral",
  "ミートアップ": "gold",
  "交流会": "green",
  networking: "gold",
  workshop: "green",
  social: "green",
  info: "muted",
};

function eventCategoryTone(category: string): EbStatusTone {
  return EVENT_CATEGORY_TONES[category] ?? "muted";
}

type TimeFilter = "all" | "upcoming" | "past";

function EventsTab({
  events,
  router,
}: {
  events: (NufEvent & { goodCount: number })[];
  router: ReturnType<typeof useRouter>;
}) {
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("upcoming");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  // カテゴリ一覧を抽出
  const categories = useMemo(() => {
    const set = new Set(events.map((e) => e.category));
    return Array.from(set);
  }, [events]);

  // フィルタリング・ソート・月別グルーピング
  const grouped = useMemo(() => {
    const today = dayjs().format("YYYY-MM-DD");

    // 時期フィルタ（イベント開始日ベースで判定）
    let filtered = events;
    if (timeFilter === "upcoming") {
      filtered = events.filter((e) => dayjs(e.startAt).format("YYYY-MM-DD") >= today);
    } else if (timeFilter === "past") {
      filtered = events.filter((e) => dayjs(e.startAt).format("YYYY-MM-DD") < today);
    }

    // カテゴリフィルタ
    if (categoryFilter !== "all") {
      filtered = filtered.filter((e) => e.category === categoryFilter);
    }

    // ソート: 今後→古い順（直近が上）, 過去/すべて→新しい順
    const sorted = Array.from(filtered).sort((a, b) => {
      const diff = dayjs(a.startAt).unix() - dayjs(b.startAt).unix();
      return timeFilter === "upcoming" ? diff : -diff;
    });

    // 月別グルーピング
    const map = new Map<string, (NufEvent & { goodCount: number })[]>();
    for (const ev of sorted) {
      const key = dayjs(ev.startAt).format("YYYY年M月");
      const arr = map.get(key);
      if (arr) arr.push(ev);
      else map.set(key, [ev]);
    }
    return Array.from(map.entries());
  }, [events, timeFilter, categoryFilter]);

  if (events.length === 0) {
    return <EmptyState message="現在開催予定のイベントはありません" />;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 時期フィルタ */}
      <SegmentedTabs
        items={[
          { id: "upcoming", label: "今後" },
          { id: "past", label: "過去" },
          { id: "all", label: "すべて" },
        ]}
        value={timeFilter}
        onChange={(id) => setTimeFilter(id as TimeFilter)}
        size="md"
      />

      {/* カテゴリフィルタ */}
      {categories.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          <CategoryChip label="すべて" selected={categoryFilter === "all"} onClick={() => setCategoryFilter("all")} />
          {categories.map((cat) => (
            <CategoryChip
              key={cat}
              label={EVENT_CATEGORY_LABELS[cat] || cat}
              selected={categoryFilter === cat}
              onClick={() => setCategoryFilter(cat)}
            />
          ))}
        </div>
      )}

      {/* ソート説明 */}
      <p className="text-[13px] text-[color:var(--eb-ink-muted)]">
        {timeFilter === "upcoming"
          ? "直近のイベントから表示"
          : timeFilter === "past"
          ? "最近のイベントから表示"
          : "新しい順に表示"}
      </p>

      {/* 一覧 */}
      {grouped.length === 0 ? (
        <EmptyState
          message={
            timeFilter === "upcoming"
              ? "今後のイベントはありません"
              : timeFilter === "past"
              ? "過去のイベントはありません"
              : "該当するイベントはありません"
          }
        />
      ) : (
        <div className="flex flex-col gap-5">
          {grouped.map(([month, items]) => (
            <div key={month}>
              {/* 月ヘッダー */}
              <div className="mb-2 flex items-center gap-2 px-0.5">
                <span className="text-[13px] font-bold text-[color:var(--eb-ink)]">{month}</span>
                <span className="text-[12px] text-[color:var(--eb-ink-muted)]">{items.length}件</span>
              </div>

              <div className="flex flex-col gap-2.5">
                {items.map((ev) => {
                  const start = dayjs(ev.startAt);
                  const end = dayjs(ev.endAt);
                  const isPastEvent = start.format("YYYY-MM-DD") < dayjs().format("YYYY-MM-DD");

                  return (
                    <button
                      key={ev.eventId}
                      type="button"
                      onClick={() => router.push(`/events/${ev.eventId}`)}
                      className="block w-full text-left active:opacity-80"
                    >
                      <GlassCard padding="md" className={clsx(isPastEvent && "opacity-60")}>
                        <div className="flex gap-3">
                          {ev.imageUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={ev.imageUrl}
                              alt=""
                              className="h-14 w-14 shrink-0 rounded-xl object-cover"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <StatusPill tone={eventCategoryTone(ev.category)}>
                                {EVENT_CATEGORY_LABELS[ev.category] || ev.category}
                              </StatusPill>
                              <span className="text-[13px] text-[color:var(--eb-ink-muted)]">
                                {start.format("M/D（ddd）")}
                              </span>
                            </div>
                            <h3 className="mt-1.5 text-[17px] font-bold leading-snug text-[color:var(--eb-ink)] line-clamp-2">
                              {ev.title}
                            </h3>
                            <p className="mt-1 truncate text-[13px] text-[color:var(--eb-ink-muted)]">
                              {start.format("HH:mm")}〜{end.format("HH:mm")}
                              {ev.location && ` ・ ${ev.location}`}
                            </p>
                          </div>
                        </div>
                      </GlassCard>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryChip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-bold transition-colors",
        selected
          ? "text-white"
          : "border border-[color:var(--eb-line)] bg-white/60 text-[color:var(--eb-ink-muted)]"
      )}
      style={selected ? { background: "var(--eb-green)" } : undefined}
    >
      {label}
    </button>
  );
}

/* ═══════════════════════════════════════════
   ニュースタブ
   ═══════════════════════════════════════════ */

const NEWS_CATEGORY_CONFIG: Record<string, { tone: EbStatusTone; label: string }> = {
  info: { tone: "muted", label: "お知らせ" },
  facility: { tone: "green", label: "施設" },
  community: { tone: "gold", label: "コミュニティ" },
};

function NewsTab({
  news,
  router,
}: {
  news: NewsItem[];
  router: ReturnType<typeof useRouter>;
}) {
  if (news.length === 0) {
    return <EmptyState message="お知らせはありません" />;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {news.map((item) => {
        const cfg = NEWS_CATEGORY_CONFIG[item.category] ?? NEWS_CATEGORY_CONFIG.info;
        return (
          <button
            key={item.newsId}
            type="button"
            onClick={() => router.push(`/news/${item.newsId}`)}
            className="block w-full text-left active:opacity-80"
          >
            <GlassCard padding="md">
              <div className="flex gap-3">
                {item.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.imageUrl}
                    alt=""
                    className="h-14 w-14 shrink-0 rounded-xl object-cover"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <StatusPill tone={cfg.tone}>{cfg.label}</StatusPill>
                    <span className="text-[13px] text-[color:var(--eb-ink-muted)]">
                      {dayjs(item.publishedAt).format("M月D日")}
                    </span>
                  </div>
                  <h3 className="mt-1.5 text-[17px] font-bold leading-snug text-[color:var(--eb-ink)] line-clamp-2">
                    {item.title}
                  </h3>
                  <p className="mt-1 text-[13px] text-[color:var(--eb-ink-muted)] line-clamp-1">
                    {item.body}
                  </p>
                </div>
              </div>
            </GlassCard>
          </button>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════
   共通: 空状態
   ═══════════════════════════════════════════ */

function EmptyState({ message }: { message: string }) {
  return (
    <GlassCard>
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" className="text-[color:var(--eb-ink-muted)]">
          <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="2" />
          <path d="M20 14v8M20 26v0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
        <p className="text-[15px] text-[color:var(--eb-ink-muted)]">{message}</p>
      </div>
    </GlassCard>
  );
}
