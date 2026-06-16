"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { NufEvent, NewsItem, Game, ScoreboardGameId } from "@/types";
import { GAME_CATEGORIES } from "@/types";
import clsx from "clsx";
import dayjs from "dayjs";
import "dayjs/locale/ja";
dayjs.locale("ja");

const TABS = [
  { id: "events", label: "イベント" },
  { id: "games", label: "ゲーム" },
  { id: "news", label: "ニュース" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function InfoPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>("events");
  const [events, setEvents] = useState<(NufEvent & { goodCount: number })[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/events").then((r) => r.json()).catch(() => ({ events: [] })),
      fetch("/api/games").then((r) => r.json()).catch(() => ({ games: [] })),
      fetch("/api/news").then((r) => r.json()).catch(() => ({ news: [] })),
    ]).then(([evData, gData, nData]) => {
      setEvents(evData.events ?? []);
      setGames(gData.games ?? []);
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
          {activeTab === "games" && (
            <GamesTab games={games} router={router} />
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

const EVENT_CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  "ワークショップ": { bg: "bg-[#A5C1C8]/20", text: "text-[#231714]" },
  "セミナー":       { bg: "bg-blue-100", text: "text-blue-700" },
  "カンファレンス": { bg: "bg-purple-100", text: "text-purple-700" },
  "ミートアップ":   { bg: "bg-amber-100", text: "text-amber-700" },
  "交流会":         { bg: "bg-[#B0E401]/15", text: "text-[#231714]" },
  // 旧カテゴリ（後方互換）
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
   ゲームタブ
   ═══════════════════════════════════════════ */

const GAME_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  upcoming:         { label: "募集中",   color: "bg-blue-100 text-blue-700" },
  ongoing:          { label: "開催中",   color: "bg-green-100 text-green-700" },
  awaiting_results: { label: "結果待ち", color: "bg-amber-100 text-amber-700" },
  completed:        { label: "完了",     color: "bg-gray-100 text-gray-500" },
};

function getGameCategoryLabel(category: string, categoryLabel?: string): string {
  if (category === "other" && categoryLabel) return categoryLabel;
  return GAME_CATEGORIES.find((c) => c.id === category)?.label ?? category;
}

interface RankingUser {
  rank: number;
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  totalScore: number;
  playedCount: number;
}

function GamesTab({
  games,
  router,
}: {
  games: Game[];
  router: ReturnType<typeof useRouter>;
}) {
  const [subTab, setSubTab] = useState<"games" | "ranking" | "cs">("games");
  const [filter, setFilter] = useState<"upcoming" | "past" | "all">("upcoming");

  // ランキングデータ
  const [ranking, setRanking] = useState<RankingUser[]>([]);
  const [gameCategory, setGameCategory] = useState<ScoreboardGameId>("mahjong");
  const [period, setPeriod] = useState<"monthly" | "annual">("monthly");
  const [yearMonth, setYearMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [rankingLoading, setRankingLoading] = useState(false);

  // CSデータ
  interface CsEventPublic {
    csEventId: string;
    title: string;
    description: string;
    startAt: string;
    endAt: string;
    location: string;
    status: string;
    candidates: { gameCategory: string; annualRank: number; displayName: string; pictureUrl: string }[];
    myCandidacies: { gameCategory: string; annualRank: number; status: string }[];
  }
  const [csEvents, setCsEvents] = useState<CsEventPublic[]>([]);
  const [csLoading, setCsLoading] = useState(false);

  // 月送り
  function shiftMonth(delta: number) {
    const [y, m] = yearMonth.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setYearMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  // ランキング取得
  useEffect(() => {
    if (subTab !== "ranking") return;
    setRankingLoading(true);
    const params = new URLSearchParams({
      gameCategory,
      period,
      yearMonth,
    });
    fetch(`/api/games/ranking?${params}`)
      .then((r) => r.json())
      .then((d) => setRanking(d.ranking ?? []))
      .catch(() => setRanking([]))
      .finally(() => setRankingLoading(false));
  }, [subTab, gameCategory, period, yearMonth]);

  // CS取得
  useEffect(() => {
    if (subTab !== "cs") return;
    setCsLoading(true);
    fetch("/api/games/cs")
      .then((r) => r.json())
      .then((d) => setCsEvents(d.csEvents ?? []))
      .catch(() => setCsEvents([]))
      .finally(() => setCsLoading(false));
  }, [subTab]);

  const filtered = useMemo(() => {
    let list = games;
    if (filter === "upcoming") {
      list = games.filter((g) => g.status === "upcoming" || g.status === "ongoing");
    } else if (filter === "past") {
      list = games.filter((g) => g.status === "completed" || g.status === "awaiting_results");
    }
    return list.sort((a, b) => {
      if (filter === "upcoming") return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
      return new Date(b.startAt).getTime() - new Date(a.startAt).getTime();
    });
  }, [games, filter]);

  return (
    <div>
      {/* 麻雀リーグ（ピラミッド）への導線 */}
      <button
        onClick={() => router.push("/games/mahjong")}
        className="w-full mb-4 flex items-center gap-3 bg-white rounded-2xl shadow-sm border border-gray-100 p-3.5 active:scale-[0.98] transition-transform text-left"
      >
        <span className="w-10 h-10 rounded-xl bg-[#A5C1C8]/15 flex items-center justify-center shrink-0">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <polygon points="12,3 7,11 17,11" fill="#E4007F" />
            <polygon points="7,11 17,11 19,16 5,16" fill="#00A0E9" />
            <polygon points="5,16 19,16 21,21 3,21" fill="#F5B400" />
          </svg>
        </span>
        <span className="flex-1">
          <span className="block text-sm font-bold text-[#231714]">麻雀リーグ</span>
          <span className="block text-[11px] text-[#231714]/45 mt-0.5">
            リーグ順位・参加表明・スコア申告
          </span>
        </span>
        <span className="text-[#231714]/30">›</span>
      </button>

      {/* サブタブ */}
      <div className="flex gap-1 mb-4 bg-[#231714]/5 rounded-xl p-1">
        <button
          onClick={() => setSubTab("games")}
          className={clsx(
            "flex-1 py-2 rounded-lg text-xs font-medium text-center transition-all",
            subTab === "games" ? "bg-white text-[#231714] shadow-sm" : "text-[#231714]/40"
          )}
        >
          ゲーム
        </button>
        <button
          onClick={() => setSubTab("ranking")}
          className={clsx(
            "flex-1 py-2 rounded-lg text-xs font-medium text-center transition-all",
            subTab === "ranking" ? "bg-white text-[#231714] shadow-sm" : "text-[#231714]/40"
          )}
        >
          ランキング
        </button>
        <button
          onClick={() => setSubTab("cs")}
          className={clsx(
            "flex-1 py-2 rounded-lg text-xs font-medium text-center transition-all",
            subTab === "cs" ? "bg-white text-[#231714] shadow-sm" : "text-[#231714]/40"
          )}
        >
          CS
        </button>
      </div>

      {/* ── ランキングタブ ── */}
      {subTab === "ranking" && (
        <div>
          {/* 種目フィルター */}
          <div className="flex gap-1 mb-3 bg-[#231714]/5 rounded-xl p-1 overflow-x-auto">
            {GAME_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setGameCategory(cat.id as ScoreboardGameId)}
                className={clsx(
                  "flex-1 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all",
                  gameCategory === cat.id ? "bg-white text-[#231714] shadow-sm" : "text-[#231714]/40"
                )}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* 麻雀はリーグ（ピラミッド）へ誘導 */}
          {gameCategory === "mahjong" && (
            <button
              onClick={() => router.push("/games/mahjong")}
              className="w-full mb-4 flex items-center gap-3 bg-white rounded-2xl shadow-sm border border-gray-100 p-3.5 active:scale-[0.98] transition-transform text-left"
            >
              <span className="w-10 h-10 rounded-xl bg-[#A5C1C8]/15 flex items-center justify-center shrink-0">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <polygon points="12,3 7,11 17,11" fill="#E4007F" />
                  <polygon points="7,11 17,11 19,16 5,16" fill="#00A0E9" />
                  <polygon points="5,16 19,16 21,21 3,21" fill="#F5B400" />
                </svg>
              </span>
              <span className="flex-1">
                <span className="block text-sm font-bold text-[#231714]">麻雀リーグ（M.LEAGUE）</span>
                <span className="block text-[11px] text-[#231714]/45 mt-0.5">
                  ピラミッド順位・参加表明・スコア申告へ
                </span>
              </span>
              <span className="text-[#231714]/30">›</span>
            </button>
          )}

          {/* 期間切替 + 月ナビ */}
          <div className="flex items-center gap-2 mb-4">
            <div className="flex gap-0.5 bg-[#231714]/5 rounded-lg p-0.5">
              <button
                onClick={() => setPeriod("monthly")}
                className={clsx(
                  "px-2.5 py-1 rounded-md text-[11px] font-medium transition-all",
                  period === "monthly" ? "bg-white text-[#231714] shadow-sm" : "text-[#231714]/40"
                )}
              >
                月間
              </button>
              <button
                onClick={() => setPeriod("annual")}
                className={clsx(
                  "px-2.5 py-1 rounded-md text-[11px] font-medium transition-all",
                  period === "annual" ? "bg-white text-[#231714] shadow-sm" : "text-[#231714]/40"
                )}
              >
                年間
              </button>
            </div>
            {period === "monthly" && (
              <div className="flex items-center gap-1.5 ml-auto">
                <button onClick={() => shiftMonth(-1)} className="px-1.5 py-0.5 text-xs text-[#231714]/40 hover:text-[#231714] rounded">
                  ←
                </button>
                <span className="text-xs font-medium text-[#231714] min-w-[70px] text-center">
                  {yearMonth.replace("-", "年") + "月"}
                </span>
                <button onClick={() => shiftMonth(1)} className="px-1.5 py-0.5 text-xs text-[#231714]/40 hover:text-[#231714] rounded">
                  →
                </button>
              </div>
            )}
          </div>

          {rankingLoading ? (
            <div className="flex justify-center py-12">
              <div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : ranking.length === 0 ? (
            <EmptyState message="まだランキングデータがありません" />
          ) : (
            <div className="space-y-2">
              {ranking.map((user) => {
                const maxScore = ranking[0]?.totalScore || 1;
                const pct = Math.round((user.totalScore / maxScore) * 100);
                return (
                  <div key={user.lineUserId} className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
                    <div className="flex items-center gap-3">
                      <span className={clsx(
                        "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                        user.rank === 1 ? "bg-yellow-100 text-yellow-700" :
                        user.rank === 2 ? "bg-gray-100 text-gray-600" :
                        user.rank === 3 ? "bg-orange-100 text-orange-600" :
                        "bg-gray-50 text-gray-400"
                      )}>
                        {user.rank}
                      </span>
                      {user.pictureUrl ? (
                        <img src={user.pictureUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-[#A5C1C8]/20 flex items-center justify-center text-xs font-bold text-[#A5C1C8] shrink-0">
                          {user.displayName.charAt(0)}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-[#231714] truncate">{user.displayName}</span>
                          <span className="text-sm font-bold text-[#231714] shrink-0">{user.totalScore.toLocaleString()}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                          <div className="h-full rounded-full bg-[#A5C1C8] transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="flex gap-3 mt-1 text-[10px] text-[#231714]/40">
                          <span>{user.playedCount}回参加</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── CSタブ ── */}
      {subTab === "cs" && (
        <div>
          {csLoading ? (
            <div className="flex justify-center py-12">
              <div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : csEvents.length === 0 ? (
            <EmptyState message="現在開催予定のCSはありません" />
          ) : (
            <div className="space-y-4">
              {csEvents.map((ev) => {
                const isMyCs = ev.myCandidacies.length > 0;
                const gameLabelMap: Record<string, string> = {
                  mahjong: "麻雀", poker: "ポーカー", billiards: "ビリヤード", darts: "ダーツ",
                };
                return (
                  <div key={ev.csEventId} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                    {/* ヘッダー */}
                    <div className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-bold text-[#231714]">{ev.title}</h3>
                        {isMyCs && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#B0E401] text-[#231714]">
                            選出
                          </span>
                        )}
                      </div>
                      {ev.description && (
                        <p className="text-xs text-[#231714]/60 mb-2">{ev.description}</p>
                      )}
                      <div className="flex gap-3 text-[10px] text-[#231714]/40">
                        <span>{ev.startAt}</span>
                        <span>{ev.location}</span>
                      </div>
                    </div>

                    {/* 自分の選出情報 */}
                    {isMyCs && (
                      <div className="mx-4 mb-3 p-3 rounded-lg bg-[#B0E401]/10 border border-[#B0E401]/30">
                        <p className="text-xs font-medium text-[#231714] mb-1">あなたは以下の種目でCS候補に選出されています</p>
                        <div className="flex flex-wrap gap-2">
                          {ev.myCandidacies.map((c) => (
                            <span
                              key={c.gameCategory}
                              className={clsx(
                                "px-2 py-0.5 rounded-full text-[10px] font-medium",
                                c.status === "declined"
                                  ? "bg-red-100 text-red-600"
                                  : "bg-[#B0E401]/20 text-[#231714]"
                              )}
                            >
                              {gameLabelMap[c.gameCategory] ?? c.gameCategory} ({c.annualRank}位)
                              {c.status === "declined" && " 辞退済"}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 候補者一覧 */}
                    {ev.candidates.length > 0 && (
                      <div className="border-t border-gray-100 p-4">
                        <p className="text-[10px] font-medium text-[#231714]/40 mb-2">CS出場者</p>
                        <div className="space-y-1">
                          {ev.candidates.map((c, i) => (
                            <div key={`${c.displayName}-${i}`} className="flex items-center gap-2 py-1">
                              <span className="text-[10px] text-[#231714]/30 w-4 text-right shrink-0">{c.annualRank}</span>
                              {c.pictureUrl ? (
                                <img src={c.pictureUrl} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
                              ) : (
                                <div className="w-6 h-6 rounded-full bg-[#A5C1C8]/20 flex items-center justify-center text-[9px] font-bold text-[#A5C1C8] shrink-0">
                                  {c.displayName.charAt(0)}
                                </div>
                              )}
                              <span className="text-xs text-[#231714]">{c.displayName}</span>
                              <span className="text-[10px] text-[#231714]/30 ml-auto">
                                {gameLabelMap[c.gameCategory] ?? c.gameCategory}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── ゲーム一覧タブ ── */}
      {subTab === "games" && (
        <>
          {/* フィルター */}
          <div className="flex gap-1.5 mb-4">
            {([
              { key: "upcoming" as const, label: "開催予定" },
              { key: "past" as const, label: "過去" },
              { key: "all" as const, label: "すべて" },
            ]).map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={clsx(
                  "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                  filter === f.key
                    ? "bg-[#231714] text-white"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <EmptyState message={filter === "upcoming" ? "開催予定のゲームはありません" : "該当するゲームはありません"} />
          ) : (
            <div className="space-y-3">
              {filtered.map((g) => {
                const isPast = g.status === "completed" || g.status === "awaiting_results";
                const isFull = (g.participantCount ?? 0) >= g.maxParticipants;
                const isDeadlinePassed = new Date(g.deadline) < new Date();
                const statusCfg = GAME_STATUS_CONFIG[g.status] ?? GAME_STATUS_CONFIG.upcoming;

                return (
                  <div
                    key={g.gameId}
                    onClick={() => router.push(`/games/${g.gameId}`)}
                    className={clsx(
                      "bg-white rounded-xl overflow-hidden shadow-sm border border-gray-100 active:scale-[0.98] transition-transform cursor-pointer",
                      isPast && "opacity-70"
                    )}
                  >
                    <div className="flex">
                      <div className={clsx(
                        "w-20 flex-shrink-0 flex flex-col items-center justify-center py-3",
                        isPast ? "bg-gray-100" : "bg-gradient-to-b from-[#A5C1C8] to-[#8BA8AF]"
                      )}>
                        <span className={clsx("text-[10px] font-bold", isPast ? "text-gray-400" : "text-white/70")}>
                          {dayjs(g.startAt).format("M月")}
                        </span>
                        <span className={clsx("text-2xl font-bold leading-none", isPast ? "text-gray-500" : "text-white")}>
                          {dayjs(g.startAt).format("D")}
                        </span>
                        <span className={clsx("text-[10px]", isPast ? "text-gray-400" : "text-white/70")}>
                          {dayjs(g.startAt).format("ddd")}
                        </span>
                      </div>
                      <div className="flex-1 p-3 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className={clsx("px-1.5 py-0.5 rounded text-[10px] font-bold", statusCfg.color)}>
                            {statusCfg.label}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-[#A5C1C8]/15 text-[10px] font-medium text-[#231714]/70">
                            {getGameCategoryLabel(g.category, g.categoryLabel)}
                          </span>
                        </div>
                        <h3 className="text-sm font-bold text-[#231714] leading-snug line-clamp-2">{g.title}</h3>
                        <div className="flex items-center gap-3 mt-1.5 text-[10px] text-[#231714]/40">
                          <span>{dayjs(g.startAt).format("HH:mm")}〜</span>
                          <span>📍 {g.location}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className={clsx("text-[11px] font-medium", isFull ? "text-red-500" : "text-[#231714]/60")}>
                            👥 {g.participantCount ?? 0}/{g.maxParticipants}名
                          </span>
                          {isFull && <span className="text-[10px] text-red-400">満員</span>}
                          {!isFull && isDeadlinePassed && g.status === "upcoming" && (
                            <span className="text-[10px] text-amber-500">締切済</span>
                          )}
                          {!isFull && !isDeadlinePassed && g.status === "upcoming" && (
                            <span className="text-[10px] text-[#231714]/30">
                              締切 {dayjs(g.deadline).format("M/D HH:mm")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
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
                  <span className="text-[10px] font-bold text-[#231714]">{cfg.label}</span>
                  <span className="text-[10px] text-gray-300">{dayjs(item.publishedAt).format("M月D日")}</span>
                </div>
                <h3 className="text-sm font-bold text-[#231714] mt-1 leading-snug line-clamp-2">{item.title}</h3>
                <p className="text-[11px] text-gray-400 mt-1 line-clamp-1">{item.body}</p>
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
