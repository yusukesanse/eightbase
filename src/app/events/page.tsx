"use client";

import { useState, useEffect } from "react";
import { TopBar } from "@/components/ui/TopBar";
import type { NufEvent } from "@/types";
import clsx from "clsx";
import dayjs from "dayjs";
import "dayjs/locale/ja";
dayjs.locale("ja");

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
  const [events, setEvents] = useState<NufEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/events")
      .then((r) => r.json())
      .then((d) => setEvents(d.events ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <TopBar title="イベント情報" subtitle="NUF 開催予定のイベント" />

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
              <EventCard key={ev.eventId} event={ev} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function EventCard({ event: ev }: { event: NufEvent }) {
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
