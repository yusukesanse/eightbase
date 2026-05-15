"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { NufEvent, Quest, NewsItem } from "@/types";
import clsx from "clsx";
import dayjs from "dayjs";
import "dayjs/locale/ja";
dayjs.locale("ja");

const TABS = [
  { id: "events", label: "イベント" },
  { id: "quests", label: "クエスト" },
  { id: "news", label: "ニュース" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function InfoPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>("events");
  const [events, setEvents] = useState<(NufEvent & { goodCount: number })[]>([]);
  const [quests, setQuests] = useState<Quest[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/events").then((r) => r.json()).catch(() => ({ events: [] })),
      fetch("/api/quests").then((r) => r.json()).catch(() => ({ quests: [] })),
      fetch("/api/news").then((r) => r.json()).catch(() => ({ news: [] })),
    ]).then(([evData, qData, nData]) => {
      setEvents(evData.events ?? []);
      setQuests(qData.quests ?? []);
      setNews(nData.news ?? []);
      setLoading(false);
    });
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <header className="bg-white pt-12 pb-0 px-5">
        <h1 className="text-[17px] font-medium text-[#231714]">Info</h1>
      </header>

      {/* タブバー */}
      <div className="bg-white border-b border-gray-100 flex sticky top-0 z-10">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-3 text-xs font-medium text-center relative transition-colors ${
              activeTab === tab.id
                ? "text-[#A5C1C8]"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            {tab.label}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-[20%] right-[20%] h-[2px] bg-[#A5C1C8] rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* コンテンツ */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="p-4">
          {activeTab === "events" && (
            <EventsTab events={events} router={router} />
          )}
          {activeTab === "quests" && (
            <QuestsTab quests={quests} router={router} />
          )}
          {activeTab === "news" && (
            <NewsTab news={news} router={router} />
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   イベントタブ（タイムライン型）
   ═══════════════════════════════════════════ */

const EVENT_CATEGORY_LABELS: Record<string, string> = {
  networking: "ネットワーキング",
  workshop: "ワークショップ",
  social: "交流",
  info: "お知らせ",
};

const EVENT_CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  networking: { bg: "bg-blue-100", text: "text-blue-700" },
  workshop:   { bg: "bg-[#A5C1C8]/20", text: "text-[#231714]" },
  social:     { bg: "bg-[#B0E401]/15", text: "text-[#231714]" },
  info:       { bg: "bg-gray-100", text: "text-[#231714]" },
};

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
    <div className="space-y-4">
      {/* フィルタバー */}
      <div className="space-y-2">
        {/* 時期フィルタ */}
        <div className="flex gap-2">
          {([
            { id: "upcoming", label: "今後" },
            { id: "past", label: "過去" },
            { id: "all", label: "すべて" },
          ] as { id: TimeFilter; label: string }[]).map((f) => (
            <button
              key={f.id}
              onClick={() => setTimeFilter(f.id)}
              className={clsx(
                "text-[11px] px-3 py-1.5 rounded-full font-medium transition-colors",
                timeFilter === f.id
                  ? "bg-[#A5C1C8] text-white"
                  : "bg-gray-100 text-gray-400 hover:bg-gray-200"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* カテゴリフィルタ */}
        {categories.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
            <button
              onClick={() => setCategoryFilter("all")}
              className={clsx(
                "text-[10px] px-2.5 py-1 rounded-full font-medium whitespace-nowrap transition-colors flex-shrink-0",
                categoryFilter === "all"
                  ? "bg-[#231714] text-white"
                  : "bg-gray-100 text-gray-400"
              )}
            >
              すべて
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={clsx(
                  "text-[10px] px-2.5 py-1 rounded-full font-medium whitespace-nowrap transition-colors flex-shrink-0",
                  categoryFilter === cat
                    ? "bg-[#231714] text-white"
                    : "bg-gray-100 text-gray-400"
                )}
              >
                {EVENT_CATEGORY_LABELS[cat] || cat}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ソート説明 */}
      <p className="text-[10px] text-gray-300">
        {timeFilter === "upcoming"
          ? "直近のイベントから表示"
          : timeFilter === "past"
          ? "最近のイベントから表示"
          : "新しい順に表示"}
      </p>

      {/* タイムライン */}
      {grouped.length === 0 ? (
        <div className="text-center py-10">
          <p className="text-sm text-gray-400">
            {timeFilter === "upcoming"
              ? "今後のイベントはありません"
              : timeFilter === "past"
              ? "過去のイベントはありません"
              : "該当するイベントはありません"}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(([month, items]) => (
            <div key={month}>
              {/* 月ヘッダー */}
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-bold text-[#231714]">{month}</span>
                <span className="text-[10px] text-gray-300">{items.length}件</span>
              </div>

              {/* タイムラインリスト */}
              <div className="relative pl-5">
                {/* 縦線 */}
                <div className="absolute left-[5px] top-2 bottom-2 w-[1.5px] bg-gray-200" />

                <div className="space-y-3">
                  {items.map((ev, idx) => {
                    const start = dayjs(ev.startAt);
                    const end = dayjs(ev.endAt);
                    const isPastEvent = start.format("YYYY-MM-DD") < dayjs().format("YYYY-MM-DD");
                    const catLabel = EVENT_CATEGORY_LABELS[ev.category] || ev.category;
                    const catColor = EVENT_CATEGORY_COLORS[ev.category] || EVENT_CATEGORY_COLORS.info;

                    return (
                      <div key={ev.eventId} className="relative">
                        {/* ドット */}
                        <div
                          className={clsx(
                            "absolute -left-5 top-3 w-[11px] h-[11px] rounded-full border-2 border-white z-10",
                            isPastEvent ? "bg-gray-300" : "bg-[#A5C1C8]"
                          )}
                        />

                        {/* カード */}
                        <div
                          onClick={() => router.push(`/events/${ev.eventId}`)}
                          className={clsx(
                            "bg-white rounded-xl overflow-hidden shadow-sm border border-gray-100 active:scale-[0.98] transition-transform cursor-pointer",
                            isPastEvent && "opacity-60"
                          )}
                        >
                          <div className="flex">
                            {ev.imageUrl ? (
                              <div className="w-20 flex-shrink-0 overflow-hidden bg-gray-100">
                                <img src={ev.imageUrl} alt="" className="w-full h-full object-cover" />
                              </div>
                            ) : (
                              <div className="w-20 flex-shrink-0 bg-gradient-to-br from-[#A5C1C8] to-[#8BA8AF] flex items-center justify-center">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" opacity="0.5">
                                  <rect x="3" y="4" width="18" height="18" rx="2" />
                                  <path d="M16 2v4M8 2v4M3 10h18" />
                                </svg>
                              </div>
                            )}
                            <div className="flex-1 p-2.5 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className={clsx("text-[9px] px-1.5 py-0.5 rounded-full font-bold", catColor.bg, catColor.text)}>
                                  {catLabel}
                                </span>
                                <span className="text-[10px] text-gray-300">
                                  {start.format("M/D（ddd）")}
                                </span>
                              </div>
                              <h3 className="text-[13px] font-bold text-[#231714] mt-1 leading-snug line-clamp-2">
                                {ev.title}
                              </h3>
                              <div className="flex items-center gap-1 mt-1 text-[10px] text-gray-400">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <circle cx="12" cy="12" r="10" />
                                  <path d="M12 6v6l4 2" />
                                </svg>
                                <span>{start.format("HH:mm")}〜{end.format("HH:mm")}</span>
                              </div>
                              {ev.location && (
                                <p className="text-[10px] text-gray-400 mt-0.5 truncate">
                                  {ev.location}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   クエストタブ
   ═══════════════════════════════════════════ */

function QuestsTab({
  quests,
  router,
}: {
  quests: Quest[];
  router: ReturnType<typeof useRouter>;
}) {
  if (quests.length === 0) {
    return <EmptyState message="現在進行中のクエストはありません" />;
  }

  return (
    <div className="space-y-3">
      {quests.map((q) => (
        <div
          key={q.questId}
          onClick={() => router.push(`/quests/${q.questId}`)}
          className="bg-white rounded-xl overflow-hidden shadow-sm border border-gray-100 active:scale-[0.98] transition-transform cursor-pointer"
        >
          <div className="flex">
            {q.imageUrl ? (
              <div className="w-24 flex-shrink-0 overflow-hidden bg-gray-100">
                <img src={q.imageUrl} alt="" className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="w-24 flex-shrink-0 bg-gradient-to-br from-[#A5C1C8] to-[#8BA8AF] flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 20 20" fill="none">
                  <path d="M10 2l1.8 5h5.2l-4.2 3.1 1.6 5L10 12l-4.4 3.1 1.6-5L3 7h5.2L10 2z" fill="white" opacity="0.8" />
                </svg>
              </div>
            )}
            <div className="flex-1 p-3 min-w-0">
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-[#A5C1C8]/25 text-[#231714]">
                {q.category}
              </span>
              <h3 className="text-sm font-bold text-[#231714] mt-1 leading-snug line-clamp-2">
                {q.title}
              </h3>
              <p className="text-[11px] text-gray-400 mt-1 line-clamp-1">
                {q.description}
              </p>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[10px] text-[#A5C1C8] font-medium">
                  {q.rewardPoints}pt
                </span>
                <span className="text-[10px] text-gray-300">
                  目標 {q.requiredCount}回
                </span>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════
   ニュースタブ
   ═══════════════════════════════════════════ */

const NEWS_CATEGORY_CONFIG: Record<string, { dot: string; label: string }> = {
  info: { dot: "bg-[#A5C1C8]", label: "お知らせ" },
  facility: { dot: "bg-[#B0E401]", label: "施設" },
  community: { dot: "bg-gray-400", label: "コミュニティ" },
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
    <div className="space-y-3">
      {news.map((item) => {
        const cfg = NEWS_CATEGORY_CONFIG[item.category] ?? NEWS_CATEGORY_CONFIG.info;

        return (
          <div
            key={item.newsId}
            onClick={() => router.push(`/news/${item.newsId}`)}
            className="bg-white rounded-xl overflow-hidden shadow-sm border border-gray-100 active:scale-[0.98] transition-transform cursor-pointer"
          >
            <div className="flex">
              {item.imageUrl ? (
                <div className="w-24 flex-shrink-0 overflow-hidden bg-gray-100">
                  <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="w-24 flex-shrink-0 bg-gradient-to-br from-[#A5C1C8] to-[#8BA8AF] flex items-center justify-center">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" opacity="0.5">
                    <path d="M4 22h16a2 2 0 002-2V4a2 2 0 00-2-2H8a2 2 0 00-2 2v16a2 2 0 01-2 2zm0 0a2 2 0 01-2-2v-9c0-1.1.9-2 2-2h2" />
                    <path d="M18 14h-8M15 18h-5M10 6h8v4h-8V6z" />
                  </svg>
                </div>
              )}
              <div className="flex-1 p-3 min-w-0">
                <div className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                  <span className="text-[10px] font-bold text-[#231714]">
                    {cfg.label}
                  </span>
                  <span className="text-[10px] text-gray-300">
                    {dayjs(item.publishedAt).format("M月D日")}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-[#231714] mt-1 leading-snug line-clamp-2">
                  {item.title}
                </h3>
                <p className="text-[11px] text-gray-400 mt-1 line-clamp-1">
                  {item.body}
                </p>
              </div>
            </div>
          </div>
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
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none" className="mb-3 text-gray-200">
        <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="2" />
        <path d="M20 14v8M20 26v0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <p className="text-sm text-gray-400">{message}</p>
    </div>
  );
}
