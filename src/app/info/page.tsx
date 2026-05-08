"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { NufEvent, Quest, NewsItem } from "@/types";
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
   イベントタブ
   ═══════════════════════════════════════════ */

const EVENT_CATEGORY_LABELS: Record<string, string> = {
  networking: "ネットワーキング",
  workshop: "ワークショップ",
  social: "交流",
  info: "お知らせ",
};

function EventsTab({
  events,
  router,
}: {
  events: (NufEvent & { goodCount: number })[];
  router: ReturnType<typeof useRouter>;
}) {
  if (events.length === 0) {
    return <EmptyState message="現在開催予定のイベントはありません" />;
  }

  return (
    <div className="space-y-3">
      {events.map((ev) => {
        const start = dayjs(ev.startAt);
        const end = dayjs(ev.endAt);
        const catLabel = EVENT_CATEGORY_LABELS[ev.category] || ev.category;

        return (
          <div
            key={ev.eventId}
            onClick={() => router.push(`/events/${ev.eventId}`)}
            className="bg-white rounded-xl overflow-hidden shadow-sm border border-gray-100 active:scale-[0.98] transition-transform cursor-pointer"
          >
            <div className="flex">
              {ev.imageUrl ? (
                <div className="w-24 flex-shrink-0 overflow-hidden bg-gray-100">
                  <img src={ev.imageUrl} alt="" className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="w-24 flex-shrink-0 bg-gradient-to-br from-[#A5C1C8] to-[#8BA8AF]" />
              )}
              <div className="flex-1 p-3 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-[#A5C1C8]/20 text-[#231714]">
                    {catLabel}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-[#231714] mt-1 leading-snug line-clamp-2">
                  {ev.title}
                </h3>
                <div className="flex items-center gap-1 mt-1.5 text-[11px] text-gray-400">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <path d="M16 2v4M8 2v4M3 10h18" />
                  </svg>
                  <span>
                    {start.format("M/D（ddd）HH:mm")}〜{end.format("HH:mm")}
                  </span>
                </div>
                <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                  {ev.location}
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
