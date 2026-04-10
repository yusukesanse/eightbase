"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/ui/TopBar";
import type { NufEvent } from "@/types";
import clsx from "clsx";
import dayjs from "dayjs";
import "dayjs/locale/ja";
dayjs.locale("ja");

/* ─── localStorage ─── */
const GOOD_KEY = "event_goods";
function getGoodSet(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(GOOD_KEY) ?? "[]")); } catch { return new Set(); }
}
function saveGoodSet(s: Set<string>) { localStorage.setItem(GOOD_KEY, JSON.stringify(Array.from(s))); }

interface EventWithGood extends NufEvent { goodCount: number; liked: boolean }

const CATEGORY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  networking: { bg: "bg-[#8BB5BF]/10", text: "text-[#231714]", label: "ネットワーキング" },
  workshop:   { bg: "bg-[#8BB5BF]/15", text: "text-[#231714]", label: "ワークショップ" },
  social:     { bg: "bg-[#B0E401]/10", text: "text-[#231714]", label: "交流" },
  info:       { bg: "bg-[#8BB5BF]/10", text: "text-[#231714]", label: "お知らせ" },
};
function getCategoryStyle(cat: string) {
  return CATEGORY_STYLES[cat] ?? { bg: "bg-gray-100", text: "text-gray-600", label: cat };
}

export default function EventsPage() {
  const router = useRouter();
  const [events, setEvents] = useState<EventWithGood[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/events");
      const d = await res.json();
      const goodSet = getGoodSet();
      const list: EventWithGood[] = (d.events ?? []).map(
        (ev: NufEvent & { goodCount?: number }) => ({
          ...ev,
          goodCount: ev.goodCount ?? 0,
          liked: goodSet.has(ev.eventId),
        })
      );
      setEvents(list);
      setLoading(false);
    })();
  }, []);

  const handleToggleGood = useCallback(async (e: React.MouseEvent, eventId: string) => {
    e.stopPropagation();
    const goodSet = getGoodSet();
    const wasLiked = goodSet.has(eventId);
    const action = wasLiked ? "remove" : "add";

    setEvents(prev => prev.map(ev =>
      ev.eventId === eventId
        ? { ...ev, liked: !wasLiked, goodCount: wasLiked ? Math.max(0, ev.goodCount - 1) : ev.goodCount + 1 }
        : ev
    ));
    if (wasLiked) goodSet.delete(eventId); else goodSet.add(eventId);
    saveGoodSet(goodSet);

    try {
      const res = await fetch(`/api/events/${eventId}/good`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const data = await res.json();
        setEvents(prev => prev.map(ev => ev.eventId === eventId ? { ...ev, goodCount: data.goodCount } : ev));
      }
    } catch {
      if (wasLiked) goodSet.add(eventId); else goodSet.delete(eventId);
      saveGoodSet(goodSet);
      setEvents(prev => prev.map(ev =>
        ev.eventId === eventId
          ? { ...ev, liked: wasLiked, goodCount: wasLiked ? ev.goodCount + 1 : Math.max(0, ev.goodCount - 1) }
          : ev
      ));
    }
  }, []);

  // 直近のイベントをフィーチャー (先頭)
  const featured = events[0];
  const rest = events.slice(1);

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <TopBar title="イベント" subtitle="EIGHT BASE UNGA 開催予定のイベント" />

      <div className="p-4">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-gray-200 border-t-[#8BB5BF] rounded-full animate-spin" />
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-16 text-sm text-gray-400">
            現在開催予定のイベントはありません
          </div>
        ) : (
          <div className="space-y-4">
            {/* Featured (大きいカード) */}
            {featured && (
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Featured</p>
                <FeaturedCard event={featured} onToggleGood={handleToggleGood} onClick={() => router.push(`/events/${featured.eventId}`)} />
              </div>
            )}

            {/* 残りのイベント */}
            {rest.length > 0 && (
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Upcoming</p>
                <div className="space-y-3">
                  {rest.map(ev => (
                    <CompactCard key={ev.eventId} event={ev} onToggleGood={handleToggleGood} onClick={() => router.push(`/events/${ev.eventId}`)} />
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

/* ─── グッド表示（アイコン＋数字） ─── */
function GoodBadge({ count, liked }: { count: number; liked: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold transition-all ${liked ? "bg-[#B0E401]/15 text-[#7BA801]" : "bg-gray-100 text-[#231714]/40"}`}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill={liked ? "#B0E401" : "none"} stroke={liked ? "#B0E401" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
      </svg>
      {count}
    </span>
  );
}

/* ─── Featured (大) カード ─── */
function FeaturedCard({ event: ev, onToggleGood, onClick }: {
  event: EventWithGood;
  onToggleGood: (e: React.MouseEvent, id: string) => void;
  onClick: () => void;
}) {
  const style = getCategoryStyle(ev.category);
  const start = dayjs(ev.startAt);
  const end = dayjs(ev.endAt);

  return (
    <div onClick={onClick} className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100 active:scale-[0.98] transition-transform cursor-pointer">
      {/* 画像 or グラデーション */}
      {ev.imageUrl ? (
        <div className="aspect-[2/1] overflow-hidden bg-gray-100">
          <img src={ev.imageUrl} alt={ev.title} className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className="aspect-[2/1] bg-gradient-to-br from-[#8BB5BF] to-[#8BA8AF] flex items-end p-5">
          <span className="text-white/60 text-xs font-medium">EIGHT BASE UNGA</span>
        </div>
      )}
      <div className="p-4">
        <div className="flex items-center gap-2">
          <span className={clsx("text-[10px] px-2 py-0.5 rounded-full font-medium", style.bg, style.text)}>
            {style.label}
          </span>
          <span className="text-[10px] text-gray-400">
            {start.format("M/D（ddd）")}
          </span>
        </div>
        <h3 className="text-base font-bold text-[#231714] mt-2 leading-snug line-clamp-2">
          {ev.title}
        </h3>
        <p className="text-xs text-gray-500 mt-1 line-clamp-2">{ev.description}</p>
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
            {start.format("HH:mm")}〜{end.format("HH:mm")}
            <span className="ml-2">{ev.location}</span>
          </div>
          <button
            onClick={(e) => onToggleGood(e, ev.eventId)}
            className="flex items-center gap-0.5 flex-shrink-0"
          >
            <GoodBadge count={ev.goodCount} liked={ev.liked} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Compact (小) カード ─── */
function CompactCard({ event: ev, onToggleGood, onClick }: {
  event: EventWithGood;
  onToggleGood: (e: React.MouseEvent, id: string) => void;
  onClick: () => void;
}) {
  const style = getCategoryStyle(ev.category);
  const start = dayjs(ev.startAt);
  const end = dayjs(ev.endAt);

  return (
    <div onClick={onClick} className="bg-white rounded-xl overflow-hidden shadow-sm border border-gray-100 flex active:scale-[0.98] transition-transform cursor-pointer">
      {/* サムネイル */}
      {ev.imageUrl ? (
        <div className="w-28 flex-shrink-0 overflow-hidden bg-gray-100">
          <img src={ev.imageUrl} alt={ev.title} className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className="w-28 flex-shrink-0 bg-gradient-to-br from-[#8BB5BF] to-[#8BA8AF]" />
      )}
      <div className="flex-1 p-3 min-w-0">
        <div className="flex items-center gap-2">
          <span className={clsx("text-[10px] px-2 py-0.5 rounded-full font-medium", style.bg, style.text)}>
            {style.label}
          </span>
        </div>
        <h3 className="text-sm font-bold text-[#231714] mt-1 leading-snug line-clamp-2">
          {ev.title}
        </h3>
        <div className="flex items-center gap-1 mt-1.5 text-[11px] text-gray-400">
          <span>{start.format("M/D（ddd）HH:mm")}〜{end.format("HH:mm")}</span>
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[11px] text-gray-400 truncate">{ev.location}</span>
          <button
            onClick={(e) => onToggleGood(e, ev.eventId)}
            className="flex items-center gap-0.5 flex-shrink-0"
          >
            <GoodBadge count={ev.goodCount} liked={ev.liked} />
          </button>
        </div>
      </div>
    </div>
  );
}
