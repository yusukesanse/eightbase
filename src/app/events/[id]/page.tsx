"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { RichText } from "@/components/ui/RichText";
import { Avatar } from "@/components/ui/LineContact";
import { getGoodSet, saveGoodSet } from "@/lib/eventGoods";
import { COMMENT_MAX_LENGTH } from "@/lib/eventComments";
import type { NufEvent } from "@/types";
import { Button, GlassCard, PageBg, StatusPill, type EbStatusTone } from "@/components/ui/eb";
import dayjs from "dayjs";
import "dayjs/locale/ja";
dayjs.locale("ja");

interface EventDetail extends NufEvent { goodCount: number }

interface Comment {
  commentId: string;
  authorId: string;
  authorName: string;
  authorPictureUrl: string;
  body: string;
  createdAt: string;
  isMine: boolean;
}

const CATEGORY_CONFIG: Record<string, { tone: EbStatusTone; label: string }> = {
  "ワークショップ": { tone: "green", label: "ワークショップ" },
  "セミナー": { tone: "gold", label: "セミナー" },
  "カンファレンス": { tone: "coral", label: "カンファレンス" },
  "ミートアップ": { tone: "gold", label: "ミートアップ" },
  "交流会": { tone: "green", label: "交流会" },
  networking: { tone: "gold", label: "ネットワーキング" },
  workshop: { tone: "green", label: "ワークショップ" },
  social: { tone: "green", label: "交流" },
  info: { tone: "muted", label: "お知らせ" },
};
function getCategoryConfig(cat: string) {
  return CATEGORY_CONFIG[cat] ?? { tone: "muted" as EbStatusTone, label: cat };
}

function commentTimeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "たった今";
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}日前`;
  return dayjs(iso).format("M月D日");
}

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [liked, setLiked] = useState(false);

  // コメント（E-2）
  const [comments, setComments] = useState<Comment[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [canPost, setCanPost] = useState(false);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  const loadComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${id}/comments`, { credentials: "include", cache: "no-store" });
      if (res.ok) {
        const d = await res.json();
        setComments(d.comments ?? []);
        if (d.currentUserId) setCurrentUserId(d.currentUserId);
      }
    } catch {
      /* noop */
    }
  }, [id]);

  useEffect(() => {
    loadComments();
    // 投稿可否（会員かつプロフィール完了・ゲスト不可）を判定してコンポーズ欄の出し分け。
    fetch("/api/auth/check", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        setCanPost(!!d?.authorized && d?.profileComplete === true && d?.role !== "guest");
        if (d?.lineUserId) setCurrentUserId(d.lineUserId);
      })
      .catch(() => {});
  }, [loadComments]);

  async function handlePostComment() {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    setCommentError(null);
    try {
      const res = await fetch(`/api/events/${id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ body }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setComments((prev) => [...prev, d.comment]);
        setDraft("");
      } else {
        setCommentError(d.message ?? d.error ?? "投稿に失敗しました");
      }
    } catch {
      setCommentError("通信エラーが発生しました");
    } finally {
      setPosting(false);
    }
  }

  async function handleDeleteComment(commentId: string) {
    if (!confirm("このコメントを削除しますか？")) return;
    try {
      const res = await fetch(`/api/events/${id}/comments/${commentId}`, { method: "DELETE", credentials: "include" });
      if (res.ok) setComments((prev) => prev.filter((c) => c.commentId !== commentId));
    } catch {
      /* noop */
    }
  }

  useEffect(() => {
    (async () => {
      try {
        // 一覧APIから探さず単体取得（limit に依存しない）
        const res = await fetch(`/api/events/${id}`, {
          credentials: "include",
          cache: "no-store",
        });
        if (res.ok) {
          const found: EventDetail = await res.json();
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
      <PageBg className="flex items-center justify-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
          style={{ borderColor: "var(--eb-green)", borderTopColor: "transparent" }}
        />
      </PageBg>
    );
  }

  if (!event) {
    return (
      <PageBg className="flex flex-col items-center justify-center gap-3">
        <p className="text-[15px] text-[color:var(--eb-ink-muted)]">イベントが見つかりません</p>
        <button onClick={() => router.back()} className="text-[15px] font-bold text-[color:var(--eb-green-text)]">
          戻る
        </button>
      </PageBg>
    );
  }

  const start = dayjs(event.startAt);
  const end = dayjs(event.endAt);
  const cfg = getCategoryConfig(event.category);

  return (
    <PageBg>
      {/* ヘッダー画像 / カラーヒーロー */}
      <div className="relative">
        {event.imageUrl ? (
          <div className="aspect-[16/9] w-full overflow-hidden bg-[color:var(--eb-tint)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={event.imageUrl} alt={event.title} className="h-full w-full object-cover" />
          </div>
        ) : (
          <div
            className="flex aspect-[16/9] w-full items-center justify-center"
            style={{ background: "linear-gradient(135deg, rgba(35,147,94,.24), rgba(35,147,94,.06))" }}
          >
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--eb-green-text)" strokeWidth="1.5" opacity="0.6">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
          </div>
        )}

        {/* 戻るボタン */}
        <button
          onClick={() => router.back()}
          className="absolute left-3 top-3 flex h-9 w-9 items-center justify-center rounded-full backdrop-blur-sm"
          style={{ background: "rgba(0,0,0,.32)" }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
      </div>

      {/* コンテンツ */}
      <div className="relative -mt-5 rounded-t-[28px] px-5 pb-24 pt-6" style={{ background: "var(--eb-bg)" }}>
        {/* カテゴリバッジ */}
        <StatusPill tone={cfg.tone}>{cfg.label}</StatusPill>

        {/* タイトル */}
        <h1 className="mt-3 text-[22px] font-bold leading-tight text-[color:var(--eb-ink)]">
          {event.title}
        </h1>

        {/* メタ情報 */}
        <GlassCard padding="md" className="mt-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: "var(--eb-tint)" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--eb-green-text)" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
                </svg>
              </div>
              <div>
                <p className="text-[15px] font-bold text-[color:var(--eb-ink)]">
                  {start.format("YYYY年M月D日（ddd）")}
                </p>
                <p className="mt-0.5 text-[13px] text-[color:var(--eb-ink-muted)]">
                  {start.format("HH:mm")} 〜 {end.format("HH:mm")}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: "var(--eb-tint)" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--eb-green-text)" strokeWidth="2">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
                  <circle cx="12" cy="9" r="2.5" />
                </svg>
              </div>
              <div>
                <p className="text-[15px] font-bold text-[color:var(--eb-ink)]">{event.location}</p>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* 説明文 */}
        <h2 className="mb-3 mt-6 text-[12px] font-bold uppercase tracking-wider text-[color:var(--eb-ink-muted)]">詳細</h2>
        <RichText
          text={event.description}
          className="text-[15px] leading-[1.7] text-[color:var(--eb-ink)]"
        />

        {/* グッドボタン */}
        <div className="mt-8">
          <Button variant={liked ? "ghost" : "primary"} onClick={handleToggleGood}>
            <span className="inline-flex items-center gap-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill={liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
              </svg>
              いいね {event.goodCount}
            </span>
          </Button>
        </div>

        {/* コメント（E-2・会員のみ・フラット一覧） */}
        <div className="mt-8">
          <h2 className="mb-3 text-[12px] font-bold uppercase tracking-wider text-[color:var(--eb-ink-muted)]">
            コメント{comments.length > 0 && ` ${comments.length}`}
          </h2>

          {/* 投稿欄（プロフィール完了会員のみ） */}
          {canPost ? (
            <div className="mb-4">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={COMMENT_MAX_LENGTH}
                rows={3}
                placeholder="コメントを書く"
                className="h-[100px] w-full resize-none rounded-2xl border border-[color:var(--eb-line)] bg-white px-4 py-3 text-[15px] leading-relaxed text-[color:var(--eb-ink)] focus:outline-none focus:border-2 focus:border-[color:var(--eb-green)]"
              />
              {commentError && <p className="mt-1.5 text-[13px] text-[color:var(--eb-coral-text)]">{commentError}</p>}
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[12px] tabular-nums text-[color:var(--eb-ink-muted)]">
                  {draft.trim().length}/{COMMENT_MAX_LENGTH}
                </span>
                <Button
                  variant="ghost"
                  fullWidth={false}
                  className="h-11 w-auto px-5 text-[14px]"
                  disabled={!draft.trim() || posting}
                  onClick={handlePostComment}
                >
                  {posting ? "投稿中…" : "送信"}
                </Button>
              </div>
            </div>
          ) : (
            <p className="mb-4 text-[13px] text-[color:var(--eb-ink-muted)]">
              コメントの投稿にはプロフィール登録が必要です。
            </p>
          )}

          {/* 一覧（古い順） */}
          {comments.length === 0 ? (
            <p className="py-6 text-center text-[15px] text-[color:var(--eb-ink-muted)]">まだコメントはありません</p>
          ) : (
            <div className="flex flex-col gap-3">
              {comments.map((c) => {
                const mine = c.isMine || c.authorId === currentUserId;
                return (
                  <div key={c.commentId} className="flex gap-2.5">
                    <Avatar src={c.authorPictureUrl} name={c.authorName} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-bold text-[color:var(--eb-ink)]">{c.authorName}</span>
                        <span className="shrink-0 text-[11px] text-[color:var(--eb-ink-muted)]">{commentTimeAgo(c.createdAt)}</span>
                        {mine && (
                          <button
                            onClick={() => handleDeleteComment(c.commentId)}
                            className="ml-auto shrink-0 text-[11px] text-[color:var(--eb-coral-text)]"
                          >
                            削除
                          </button>
                        )}
                      </div>
                      <p className="mt-0.5 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-[color:var(--eb-ink)]">
                        {c.body}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </PageBg>
  );
}
