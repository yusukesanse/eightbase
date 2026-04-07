"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { RichText } from "@/components/ui/RichText";
import type { NufEvent } from "@/types";
import dayjs from "dayjs";
import "dayjs/locale/ja";
dayjs.locale("ja");

/* ─── localStorage ─── */
const GOOD_KEY = "event_goods";
function getGoodSet(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(GOOD_KEY) ?? "[]")); } catch { return new Set(); }
}
function saveGoodSet(s: Set<string>) { localStorage.setItem(GOOD_KEY, JSON.stringify(Array.from(s))); }

interface EventDetail extends NufEvent { goodCount: number }

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [liked, setLiked] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/events");
        const d = await res.json();
        const found = (d.events ?? []).find((e: EventDetail) => e.eventId === id);
        if (found) {
          setEvent(found);
          setLiked(getGoodSet().has(found.eventId));
        }
      } finally { setLoading(false); }
    })();
  }, [id]);

  const handleToggleGood = useCallback(async () => {
    if (!event) return;
    const goodSet = getGoodSet();
    const wasLiked = goodSet.has(event.eventId);
    const action = wasLiked ? "remove" : "add";

    setLiked(!wasLiked);
    setEvent(prev => prev ? { ...prev, goodCount: wasLiked ? Math.max(0, prev.goodCount - 1) : prev.goodCount + 1 } : prev);
    if (wasLiked) goodSet.delete(event.eventId); else goodSet.add(event.eventId);
    saveGoodSet(goodSet);

    try {
      const res = await fetch(`/api/events/${event.eventId}/good`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const data = await res.json();
        setEvent(prev => prev ? { ...prev, goodCount: data.goodCount } : prev);
      }
    } catch {
      if (wasLiked) goodSet.add(event.eventId); else goodSet.delete(event.eventId);
      saveGoodSet(goodSet);
      setLiked(wasLiked);
    }
  }, [event]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-[#06C755] rounded-full animate-spin" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-3">
        <p className="text-gray-400 text-sm">イベントが見つかりません</p>
        <button onClick={() => router.back()} className="text-sm text-[#06C755]">戻る</button>
      </div>
    );
  }

  const start = dayjs(event.startAt);
  const end = dayjs(event.endAt);

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      {/* ヘッダー画像 / カラーヒーロー */}
      <div className="relative">
        {event.imageUrl ? (
          <div className="aspect-[16/9] w-full overflow-hidden bg-gray-100">
            <img src={event.imageUrl} alt={event.title} className="w-full h-full object-cover" />
          </div>
        ) : (
          <div className="aspect-[16/9] w-full bg-gradient-to-br from-[#06C755] to-emerald-600 flex items-center justify-center">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" opacity="0.5">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
          </div>
        )}

        {/* 戻るボタン */}
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
        <span className="inline-block text-[11px] px-3 py-1 rounded-full font-medium bg-emerald-50 text-emerald-700">
          {event.category}
        </span>

        {/* タイトル */}
        <h1 className="text-xl font-bold text-gray-900 mt-3 leading-tight">
          {event.title}
        </h1>

        {/* メタ情報 */}
        <div className="mt-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#06C755" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">
                {start.format("YYYY年M月D日（ddd）")}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {start.format("HH:mm")} 〜 {end.format("HH:mm")}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#06C755" strokeWidth="2">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
                <circle cx="12" cy="9" r="2.5" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">{event.location}</p>
            </div>
          </div>
        </div>

        {/* 区切り */}
        <hr className="my-5 border-gray-100" />

        {/* 説明文 */}
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">詳細</h2>
        <RichText
          text={event.description}
          className="text-sm text-gray-700 leading-relaxed"
        />

        {/* グッドボタン */}
        <div className="mt-8 flex items-center gap-3">
          <button
            onClick={handleToggleGood}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium transition-all ${
              liked
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "bg-gray-50 text-gray-500 border border-gray-200"
            }`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill={liked ? "#06C755" : "none"} stroke={liked ? "#06C755" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
            </svg>
            いいね {event.goodCount}
          </button>
        </div>
      </div>
    </div>
  );
}
