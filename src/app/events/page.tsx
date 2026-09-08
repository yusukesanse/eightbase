"use client";

import { useState, useEffect, useLayoutEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { getGoodSet, saveGoodSet } from "@/lib/eventGoods";
import { filterAndSortEvents, type EventTimeFilter } from "@/lib/eventListing";
import { todayJst } from "@/lib/date";
import type { NufEvent } from "@/types";
import { GlassCard, PageBg, PageHeading, SegmentedTabs, StatusPill, type EbStatusTone } from "@/components/ui/eb";

// キャッシュ即表示と同じ paint 前タイミングでグッド状態を重ねるため layout effect を使う
// （再訪時に一瞬「イベントなし」が見えるのを防ぐ）。SSR では useEffect にフォールバック。
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;
import clsx from "clsx";
import dayjs from "dayjs";
import "dayjs/locale/ja";
dayjs.locale("ja");

interface EventWithGood extends NufEvent { goodCount: number; liked: boolean }

const CATEGORY_CONFIG: Record<string, { tone: EbStatusTone; label: string }> = {
  // 新カテゴリ（日本語キー）
  "ワークショップ": { tone: "green", label: "ワークショップ" },
  "セミナー": { tone: "gold", label: "セミナー" },
  "カンファレンス": { tone: "coral", label: "カンファレンス" },
  "ミートアップ": { tone: "gold", label: "ミートアップ" },
  "交流会": { tone: "green", label: "交流会" },
  // 旧カテゴリ（後方互換）
  networking: { tone: "gold", label: "ネットワーキング" },
  workshop: { tone: "green", label: "ワークショップ" },
  social: { tone: "green", label: "交流" },
  info: { tone: "muted", label: "お知らせ" },
};
function getCategoryConfig(cat: string) {
  return CATEGORY_CONFIG[cat] ?? { tone: "muted" as EbStatusTone, label: cat };
}

export default function EventsPage() {
  const router = useRouter();

  // 前回表示を即出し→裏で再取得（数分キャッシュ）。info ページとキーを共有する。
  const { data, isLoading } = useStaleWhileRevalidate<{
    events: (NufEvent & { goodCount?: number })[];
  }>("events:list", () =>
    fetch("/api/events", { credentials: "include", cache: "no-store" }).then((r) =>
      r.json()
    )
  );

  // グッド状態(localStorage)を重ねた表示用リスト。data が更新されるたびに作り直す
  // ことで、裏で再取得された差分（新規イベントや goodCount）が反映される。
  const [events, setEvents] = useState<EventWithGood[]>([]);
  useIsomorphicLayoutEffect(() => {
    if (!data) return;
    const goodSet = getGoodSet();
    setEvents(
      (data.events ?? []).map((ev) => ({
        ...ev,
        goodCount: ev.goodCount ?? 0,
        liked: goodSet.has(ev.eventId),
      }))
    );
  }, [data]);

  // フルスクリーンスピナーは初回（キャッシュ無し）のみ
  const loading = isLoading;

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

  // 今後 / 過去 / すべて。既定は「今後」（LINE の「イベントを見る」から開いたとき、
  // 次に開催されるイベントが先頭に来るようにする。/info のイベントタブと同じ関数で判定）。
  const [timeFilter, setTimeFilter] = useState<EventTimeFilter>("upcoming");
  const visible = useMemo(
    () => filterAndSortEvents(events, timeFilter, todayJst()),
    [events, timeFilter]
  );

  // 先頭をフィーチャー（今後＝次のイベント / 過去・すべて＝最新のイベント）
  const featured = visible[0];
  const rest = visible.slice(1);
  const restLabel = timeFilter === "upcoming" ? "Upcoming" : timeFilter === "past" ? "Past" : "All";
  const emptyMessage =
    timeFilter === "upcoming"
      ? "今後のイベントはありません"
      : timeFilter === "past"
      ? "過去のイベントはありません"
      : "該当するイベントはありません";

  return (
    <PageBg>
      <div className="px-5 pt-[52px]">
        <PageHeading title="イベント" subtitle="EIGHT BASE UNGA 開催予定のイベント" />
      </div>

      <div className="px-5 pt-5 pb-10">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div
              className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
              style={{ borderColor: "var(--eb-green)", borderTopColor: "transparent" }}
            />
          </div>
        ) : events.length === 0 ? (
          <GlassCard>
            <p className="py-6 text-center text-[15px] text-[color:var(--eb-ink-muted)]">
              現在開催予定のイベントはありません
            </p>
          </GlassCard>
        ) : (
          <div className="flex flex-col gap-4">
            <SegmentedTabs
              items={[
                { id: "upcoming", label: "今後" },
                { id: "past", label: "過去" },
                { id: "all", label: "すべて" },
              ]}
              value={timeFilter}
              onChange={(id) => setTimeFilter(id as EventTimeFilter)}
              size="md"
            />

            {visible.length === 0 && (
              <GlassCard>
                <p className="py-6 text-center text-[15px] text-[color:var(--eb-ink-muted)]">
                  {emptyMessage}
                </p>
              </GlassCard>
            )}

            {/* Featured (大きいカード) */}
            {featured && (
              <div>
                <p className="mb-2 text-[12px] font-bold uppercase tracking-wider text-[color:var(--eb-ink-muted)]">
                  Featured
                </p>
                <FeaturedCard event={featured} onToggleGood={handleToggleGood} onClick={() => router.push(`/events/${featured.eventId}`)} />
              </div>
            )}

            {/* 残りのイベント */}
            {rest.length > 0 && (
              <div>
                <p className="mb-2 text-[12px] font-bold uppercase tracking-wider text-[color:var(--eb-ink-muted)]">
                  {restLabel}
                </p>
                <div className="flex flex-col gap-2.5">
                  {rest.map(ev => (
                    <CompactCard key={ev.eventId} event={ev} onToggleGood={handleToggleGood} onClick={() => router.push(`/events/${ev.eventId}`)} />
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

/* ─── グッド表示（アイコン＋数字） ─── */
function GoodBadge({ count, liked }: { count: number; liked: boolean }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[12px] font-bold transition-all",
        liked ? "text-[color:var(--eb-green-text)]" : "text-[color:var(--eb-ink-muted)]"
      )}
      style={{ background: liked ? "rgba(35,147,94,.14)" : "var(--eb-tint)" }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill={liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
  const cfg = getCategoryConfig(ev.category);
  const start = dayjs(ev.startAt);
  const end = dayjs(ev.endAt);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter") onClick(); }}
      className="cursor-pointer active:opacity-80"
    >
      <GlassCard className="overflow-hidden !p-0">
        {/* 画像 or トーン背景 */}
        {ev.imageUrl ? (
          <div className="aspect-[2/1] overflow-hidden bg-[color:var(--eb-tint)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={ev.imageUrl} alt={ev.title} className="h-full w-full object-cover" />
          </div>
        ) : (
          <div
            className="flex aspect-[2/1] items-end p-5"
            style={{ background: "linear-gradient(135deg, rgba(35,147,94,.24), rgba(35,147,94,.06))" }}
          >
            <span className="text-[12px] font-medium text-[color:var(--eb-green-text)]">EIGHT BASE UNGA</span>
          </div>
        )}
        <div className="p-4">
          <div className="flex items-center gap-2">
            <StatusPill tone={cfg.tone}>{cfg.label}</StatusPill>
            <span className="text-[13px] text-[color:var(--eb-ink-muted)]">
              {start.format("M/D（ddd）")}
            </span>
          </div>
          <h3 className="mt-2 text-[17px] font-bold leading-snug text-[color:var(--eb-ink)] line-clamp-2">
            {ev.title}
          </h3>
          <p className="mt-1 text-[13px] text-[color:var(--eb-ink-muted)] line-clamp-2">{ev.description}</p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1 text-[12px] max-[360px]:text-[11px] text-[color:var(--eb-ink-muted)]">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
              <span className="shrink-0 whitespace-nowrap">{start.format("HH:mm")}〜{end.format("HH:mm")}</span>
              <span className="ml-2 truncate">{ev.location}</span>
            </div>
            <button
              type="button"
              onClick={(e) => onToggleGood(e, ev.eventId)}
              className="flex shrink-0 items-center gap-0.5"
            >
              <GoodBadge count={ev.goodCount} liked={ev.liked} />
            </button>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}

/* ─── Compact (小) カード ─── */
function CompactCard({ event: ev, onToggleGood, onClick }: {
  event: EventWithGood;
  onToggleGood: (e: React.MouseEvent, id: string) => void;
  onClick: () => void;
}) {
  const cfg = getCategoryConfig(ev.category);
  const start = dayjs(ev.startAt);
  const end = dayjs(ev.endAt);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter") onClick(); }}
      className="cursor-pointer active:opacity-80"
    >
      <GlassCard padding="md">
        <div className="flex gap-3">
          {/* サムネイル */}
          {ev.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ev.imageUrl} alt={ev.title} className="h-16 w-16 shrink-0 rounded-xl object-cover" />
          ) : (
            <div
              className="h-16 w-16 shrink-0 rounded-xl"
              style={{ background: "linear-gradient(135deg, rgba(35,147,94,.24), rgba(35,147,94,.06))" }}
            />
          )}
          <div className="min-w-0 flex-1">
            <StatusPill tone={cfg.tone}>{cfg.label}</StatusPill>
            <h3 className="mt-1.5 text-[15px] font-bold leading-snug text-[color:var(--eb-ink)] line-clamp-2">
              {ev.title}
            </h3>
            <div className="mt-1 text-[12px] text-[color:var(--eb-ink-muted)]">
              {start.format("M/D（ddd）HH:mm")}〜{end.format("HH:mm")}
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[12px] text-[color:var(--eb-ink-muted)]">{ev.location}</span>
              <button
                type="button"
                onClick={(e) => onToggleGood(e, ev.eventId)}
                className="flex shrink-0 items-center gap-0.5"
              >
                <GoodBadge count={ev.goodCount} liked={ev.liked} />
              </button>
            </div>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
