"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { RichText } from "@/components/ui/RichText";
import { Avatar } from "@/components/ui/LineContact";
import { getGoodSet, saveGoodSet } from "@/lib/eventGoods";
import { COMMENT_MAX_LENGTH } from "@/lib/eventComments";
import type { NufEvent } from "@/types";
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
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-[#A5C1C8] rounded-full animate-spin" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-3">
        <p className="text-gray-700 text-sm">イベントが見つかりません</p>
        <button onClick={() => router.back()} className="text-sm text-[#4f757e]">戻る</button>
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
          <div className="aspect-[16/9] w-full bg-gradient-to-br from-[#A5C1C8] to-[#8BA8AF] flex items-center justify-center">
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
        <span className="inline-block text-[11px] px-3 py-1 rounded-full font-medium bg-[#A5C1C8]/25 text-[#231714]">
          {event.category}
        </span>

        {/* タイトル */}
        <h1 className="text-xl font-bold text-[#231714] mt-3 leading-tight">
          {event.title}
        </h1>

        {/* メタ情報 */}
        <div className="mt-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#A5C1C8]/20 flex items-center justify-center flex-shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#A5C1C8" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-[#231714]">
                {start.format("YYYY年M月D日（ddd）")}
              </p>
              <p className="text-xs text-gray-700 mt-0.5">
                {start.format("HH:mm")} 〜 {end.format("HH:mm")}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#A5C1C8]/20 flex items-center justify-center flex-shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#A5C1C8" strokeWidth="2">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
                <circle cx="12" cy="9" r="2.5" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-[#231714]">{event.location}</p>
            </div>
          </div>
        </div>

        {/* 区切り */}
        <hr className="my-5 border-gray-100" />

        {/* 説明文 */}
        <h2 className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-3">詳細</h2>
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
                ? "bg-[#B0E401]/10 text-[#231714] border border-[#B0E401]/30"
                : "bg-gray-50 text-gray-700 border border-gray-200"
            }`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill={liked ? "#B0E401" : "none"} stroke={liked ? "#B0E401" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
            </svg>
            いいね {event.goodCount}
          </button>
        </div>

        {/* コメント（E-2・会員のみ・フラット一覧） */}
        <div className="mt-8">
          <h2 className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-3">
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
                style={{ fontSize: "16px" }}
                className="w-full px-3 py-2.5 text-[15px] leading-relaxed text-[#231714] bg-white rounded-xl border border-gray-200 focus:outline-none focus:border-[#A5C1C8] resize-none"
              />
              {commentError && <p className="mt-1.5 text-xs text-[#d8533a]">{commentError}</p>}
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] text-gray-400 tabular-nums">
                  {draft.trim().length}/{COMMENT_MAX_LENGTH}
                </span>
                <button
                  onClick={handlePostComment}
                  disabled={!draft.trim() || posting}
                  className="px-4 py-2 rounded-full text-sm font-medium text-white bg-[#231714] disabled:opacity-40 active:scale-[0.98] transition-transform"
                >
                  {posting ? "投稿中…" : "投稿する"}
                </button>
              </div>
            </div>
          ) : (
            <p className="mb-4 text-xs text-gray-500">
              コメントの投稿にはプロフィール登録が必要です。
            </p>
          )}

          {/* 一覧（古い順） */}
          {comments.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">まだコメントはありません</p>
          ) : (
            <div className="flex flex-col gap-3">
              {comments.map((c) => {
                const mine = c.isMine || c.authorId === currentUserId;
                return (
                  <div key={c.commentId} className="flex gap-2.5">
                    <Avatar src={c.authorPictureUrl} name={c.authorName} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-bold text-[#231714] truncate">{c.authorName}</span>
                        <span className="text-[11px] text-gray-400 shrink-0">{commentTimeAgo(c.createdAt)}</span>
                        {mine && (
                          <button
                            onClick={() => handleDeleteComment(c.commentId)}
                            className="ml-auto text-[11px] text-[#d82328] shrink-0"
                          >
                            削除
                          </button>
                        )}
                      </div>
                      <p className="text-[14px] text-[#40434a] leading-relaxed mt-0.5 whitespace-pre-wrap break-words">
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
    </div>
  );
}
