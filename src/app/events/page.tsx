"use client";

import { useState, useEffect, useCallback } from "react";
import { TopBar } from "@/components/ui/TopBar";
import type { NufEvent } from "@/types";
import clsx from "clsx";
import dayjs from "dayjs";
import "dayjs/locale/ja";
dayjs.locale("ja");

/* ───────── localStorage ヘルパー ───────── */

const GOOD_KEY = "event_goods";

function getGoodSet(): Set<string> {
  try {
    const raw = localStorage.getItem(GOOD_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveGoodSet(s: Set<string>) {
  localStorage.setItem(GOOD_KEY, JSON.stringify(Array.from(s)));
}

/* ───────── 型 ───────── */

interface EventWithGood extends NufEvent {
  goodCount: number;
  liked: boolean;
}

const CATEGORY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  networking: { bg: "bg-teal-50", text: "text-teal-800", label: "ネットワーキング" },
  workshop:   { bg: "bg-purple-50", text: "text-purple-800", label: "ワークショップ" },
  social:     { bg: "bg-amber-50", text: "text-amber-800", label: "交流" },
  info:       { bg: "bg-blue-50", text: "text-blue-800", label: "お知らせ" },
};

function getCategoryStyle(cat: string) {
  return CATEGORY_STYLES[cat] ?? { bg: "bg-gray-100", text: "text-gray-600", label: cat };
}

export default function EventsPage() {
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

  const handleToggleGood = useCallback(async (eventId: string) => {
    const goodSet = getGoodSet();
    const wasLiked = goodSet.has(eventId);
    const action = wasLiked ? "remove" : "add";

    // 楽観的UI更新
    setEvents((prev) =>
      prev.map((ev) =>
        ev.eventId === eventId
          ? {
              ...ev,
              liked: !wasLiked,
              goodCount: wasLiked
                ? Math.max(0, ev.goodCount - 1)
                : ev.goodCount + 1,
            }
          : ev
      )
    );

    // localStorage を更新
    if (wasLiked) {
      goodSet.delete(eventId);
    } else {
      goodSet.add(eventId);
    }
    saveGoodSet(goodSet);

    try {
      const res = await fetch(`/api/events/${eventId}/good`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error();

      // サーバーの正確な値で補正
      const data = await res.json();
      setEvents((prev) =>
        prev.map((ev) =>
          ev.eventId === eventId ? { ...ev, goodCount: data.goodCount } : ev
        )
      );
    } catch {
      // 失敗時はロールバック
      if (wasLiked) {
        goodSet.add(eventId);
      } else {
        goodSet.delete(eventId);
      }
      saveGoodSet(goodSet);

      setEvents((prev) =>
        prev.map((ev) =>
          ev.eventId === eventId
            ? {
                ...ev,
                liked: wasLiked,
                goodCount: wasLiked
                  ? ev.goodCount + 1
                  : Math.max(0, ev.goodCount - 1),
              }
            : ev
        )
      );
    }
  }, []);

  return (
    <div>
      <TopBar title="イベント情報" subtitle="EIGHT BASE UNGA 開催予定のイベント" />

      <div className="p-3 space-y-3">
        {loading ? (
          <div className="text-center py-8 text-sm text-gray-400">読み込み中...</div>
        ) : events.length === 0 ? (
          <div className="text-center py-12 text-sm text-gray-400">
            現在開催予定のイベントはありません
          </div>
        ) : (
          <>
            <p className="text-xs font-medium text-gray-400">開催予定</p>
            {events.map((ev) => (
              <EventCard
                key={ev.eventId}
                event={ev}
                onToggleGood={handleToggleGood}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/* ───────── グッドアイコン表示 ───────── */

function GoodIcon({ filled, size = 14 }: { filled?: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "#06C755" : "none"}
      stroke={filled ? "#06C755" : "currentColor"}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
    </svg>
  );
}

function GoodDisplay({ count }: { count: number }) {
  if (count === 0) return null;

  const displayCount = Math.min(count, 10);
  const overflow = count > 10 ? count - 10 : 0;

  return (
    <div className="flex items-center gap-0.5 mt-1.5">
      <div className="flex -space-x-1">
        {Array.from({ length: displayCount }).map((_, i) => (
          <span key={i} className="inline-block">
            <GoodIcon filled size={12} />
          </span>
        ))}
      </div>
      {overflow > 0 && (
        <span className="text-[10px] font-medium text-green-600 ml-1">
          +{overflow}
        </span>
      )}
    </div>
  );
}

/* ───────── イベントカード ───────── */

function EventCard({
  event: ev,
  onToggleGood,
}: {
  event: EventWithGood;
  onToggleGood: (eventId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const style = getCategoryStyle(ev.category);
  const start = dayjs(ev.startAt);
  const end   = dayjs(ev.endAt);
  const dateLabel = start.format("M月D日（ddd）HH:mm");
  const endLabel  = end.format("HH:mm");

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      {/* カラーバー */}
      <div className="h-1.5 bg-[#06C755]" />
      <div className="p-3">
        <span className={clsx("text-[10px] px-2 py-0.5 rounded-full font-medium", style.bg, style.text)}>
          {style.label}
        </span>
        <h3 className="text-sm font-medium text-gray-800 mt-1.5 leading-snug">
          {ev.title}
        </h3>
        <div className="flex items-center gap-1 mt-1.5 text-xs text-gray-400">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="1" y="1.5" width="10" height="9" rx="2" stroke="currentColor" strokeWidth="1"/>
            <path d="M4 1v1M8 1v1M1 4.5h10" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
          </svg>
          {dateLabel} 〜 {endLabel}
        </div>
        <div className="flex items-center gap-1 mt-0.5 text-xs text-gray-400">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 1C4.34 1 3 2.34 3 4c0 2.25 3 7 3 7s3-4.75 3-7c0-1.66-1.34-3-3-3z" stroke="currentColor" strokeWidth="1"/>
            <circle cx="6" cy="4" r="1" stroke="currentColor" strokeWidth="1"/>
          </svg>
          {ev.location}
        </div>

        {/* グッドボタン + 表示 */}
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={() => onToggleGood(ev.eventId)}
            className={clsx(
              "flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all",
              ev.liked
                ? "bg-green-50 text-green-700 border border-green-200"
                : "bg-gray-50 text-gray-400 border border-gray-100 hover:bg-gray-100"
            )}
          >
            <GoodIcon filled={ev.liked} size={14} />
            <span>{ev.goodCount}</span>
          </button>
        </div>

        {/* グッドアイコン並び表示 */}
        <GoodDisplay count={ev.goodCount} />

        {/* 詳細展開 */}
        <button
          onClick={() => setOpen((o) => !o)}
          className="text-xs text-[#06C755] mt-2"
        >
          {open ? "▲ 閉じる" : "▼ 詳細を見る"}
        </button>

        {open && (
          <p className="text-xs text-gray-500 mt-2 leading-relaxed border-t border-gray-100 pt-2">
            {ev.description}
          </p>
        )}
      </div>
    </div>
  );
}
