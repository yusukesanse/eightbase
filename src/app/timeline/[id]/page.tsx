"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { type CachedPost as Post, findCachedPost } from "@/lib/timelineCache";

interface Comment {
  commentId: string;
  authorId: string;
  authorName: string;
  authorPictureUrl: string;
  content: string;
  createdAt: string;
}

export default function PostDetailPage() {
  const router = useRouter();
  const params = useParams();
  const postId = params.id as string;

  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState("");
  const [commentText, setCommentText] = useState("");
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const commentInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 一覧キャッシュに該当投稿があれば即表示（スピナーを避ける）
    const cached = findCachedPost(postId);
    if (cached) {
      setPost(cached);
      setLoading(false);
    }
    loadData();
  }, [postId]);

  async function loadData() {
    try {
      // ユーザーID取得
      const authRes = await fetch("/api/auth/check", {
        credentials: "include",
        cache: "no-store",
      });
      const authData = await authRes.json();
      if (!authData.authorized) {
        router.replace("/login");
        return;
      }
      setCurrentUserId(authData.lineUserId || "");

      // 投稿を単体取得（一覧の最新30件から探さない）
      const postRes = await fetch(`/api/posts/${postId}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (postRes.ok) {
        setPost(await postRes.json());
      }

      // コメント取得
      const commentsRes = await fetch(`/api/posts/${postId}/comments`, {
        credentials: "include",
        cache: "no-store",
      });
      if (commentsRes.ok) {
        setComments(await commentsRes.json());
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function toggleLike() {
    if (!post) return;
    try {
      const res = await fetch(`/api/posts/${postId}/like`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return;
      const { liked } = await res.json();

      setPost((prev) => {
        if (!prev) return prev;
        const newLikes = liked
          ? [...prev.likes, currentUserId]
          : prev.likes.filter((id) => id !== currentUserId);
        return { ...prev, likes: newLikes };
      });
    } catch {
      // ignore
    }
  }

  async function submitComment() {
    if (!commentText.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/posts/${postId}/comments`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: commentText.trim() }),
      });
      if (res.ok) {
        setCommentText("");
        // コメント一覧を再読み込み
        const commentsRes = await fetch(`/api/posts/${postId}/comments`, {
          credentials: "include",
          cache: "no-store",
        });
        if (commentsRes.ok) {
          setComments(await commentsRes.json());
        }
        // 投稿のcommentCountも更新
        setPost((prev) =>
          prev ? { ...prev, commentCount: prev.commentCount + 1 } : prev
        );
      }
    } catch {
      // ignore
    } finally {
      setSending(false);
    }
  }

  async function handleDelete() {
    if (!confirm("この投稿を削除しますか？")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/posts/${postId}`, {
        method: "DELETE",
        credentials: "include",
        cache: "no-store",
      });
      if (res.ok) {
        router.replace("/timeline");
      } else {
        const data = await res.json();
        alert(data.error || "削除に失敗しました");
      }
    } catch {
      alert("通信エラーが発生しました");
    } finally {
      setDeleting(false);
    }
  }

  const isOwner = currentUserId && post?.authorId === currentUserId;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-10 h-10 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!post) {
    return (
      <div className="min-h-screen bg-gray-50 pb-20">
        <header className="bg-white pt-12 pb-4 px-5 flex items-center gap-3 border-b border-gray-100">
          <button onClick={() => router.back()} className="p-1">
            <BackIcon />
          </button>
          <h1 className="text-[15px] font-medium text-[#231714]">投稿</h1>
        </header>
        <div className="flex flex-col items-center justify-center py-20">
          <p className="text-sm text-gray-500">投稿が見つかりません</p>
        </div>
      </div>
    );
  }

  const liked = post.likes.includes(currentUserId);

  return (
    <div className="min-h-screen bg-gray-50 pb-40">
      {/* ヘッダー */}
      <header className="bg-white pt-12 pb-4 px-5 flex items-center gap-3 border-b border-gray-100">
        <button onClick={() => router.back()} className="p-1">
          <BackIcon />
        </button>
        <h1 className="text-[15px] font-medium text-[#231714] flex-1">投稿</h1>
        {isOwner && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50 px-2 py-1"
          >
            {deleting ? "削除中..." : "削除"}
          </button>
        )}
      </header>

      {/* 投稿本文 */}
      <div className="bg-white px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2.5 mb-3">
          {post.authorPictureUrl ? (
            <img
              src={post.authorPictureUrl}
              alt=""
              className="w-10 h-10 rounded-full object-cover"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-[#A5C1C8]/20 flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M9 2a3.5 3.5 0 013.5 3.5v0A3.5 3.5 0 019 9v0a3.5 3.5 0 01-3.5-3.5v0A3.5 3.5 0 019 2z" stroke="#A5C1C8" strokeWidth="1.2" />
                <path d="M2 16c0-3.5 2.8-6 7-6s7 2.5 7 6" stroke="#A5C1C8" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-medium text-[#231714] truncate">
              {post.authorName}
            </p>
            <div className="flex items-center gap-2">
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                  post.type === "offer"
                    ? "bg-[#B0E401]/15 text-[#7A9E00]"
                    : "bg-[#F5A623]/15 text-[#C4841D]"
                }`}
              >
                {post.type === "offer" ? "できます" : "探してます"}
              </span>
              <span className="text-[10px] text-gray-500">
                {getRelativeTime(post.createdAt)}
              </span>
            </div>
          </div>
        </div>

        <p className="text-[14px] text-[#231714] leading-relaxed whitespace-pre-wrap">
          {post.content}
        </p>

        {post.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {post.tags.map((tag) => (
              <span
                key={tag}
                className="text-[11px] text-[#4f757e] px-2 py-0.5"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}

        {/* アクションバー */}
        <div className="flex items-center gap-5 mt-4 pt-3 border-t border-gray-50">
          <button onClick={toggleLike} className="flex items-center gap-1.5">
            <svg width="18" height="18" viewBox="0 0 18 18" fill={liked ? "#F56565" : "none"}>
              <path
                d="M9 16s-6.5-4-6.5-8A3.5 3.5 0 019 5a3.5 3.5 0 016.5 3c0 4-6.5 8-6.5 8z"
                stroke={liked ? "#F56565" : "#ccc"}
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
            <span className={`text-[12px] ${liked ? "text-red-400" : "text-gray-500"}`}>
              {post.likes.length}
            </span>
          </button>
          <button
            onClick={() => commentInputRef.current?.focus()}
            className="flex items-center gap-1.5"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path
                d="M2 3h14a1 1 0 011 1v8a1 1 0 01-1 1H6l-4 4V4a1 1 0 011-1z"
                stroke="#ccc"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
            <span className="text-[12px] text-gray-500">
              {comments.length}
            </span>
          </button>
        </div>
      </div>

      {/* コメント一覧 */}
      {comments.length > 0 && (
        <div className="mt-3">
          <div className="px-5 py-2">
            <p className="text-[12px] text-[#231714]/60">コメント</p>
          </div>
          {comments.map((c) => (
            <div
              key={c.commentId}
              className="bg-white px-5 py-3 border-b border-gray-50"
            >
              <div className="flex items-start gap-2.5">
                {c.authorPictureUrl ? (
                  <img
                    src={c.authorPictureUrl}
                    alt=""
                    className="w-7 h-7 rounded-full object-cover mt-0.5"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-[#A5C1C8]/20 flex items-center justify-center mt-0.5">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M6 1.5a2 2 0 012 2v0a2 2 0 01-4 0v0a2 2 0 012-2z" stroke="#A5C1C8" strokeWidth="1" />
                      <path d="M1.5 10.5c0-2.2 1.8-4 4.5-4s4.5 1.8 4.5 4" stroke="#A5C1C8" strokeWidth="1" strokeLinecap="round" />
                    </svg>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-medium text-[#231714]">
                      {c.authorName}
                    </span>
                    <span className="text-[10px] text-gray-500">
                      {getRelativeTime(c.createdAt)}
                    </span>
                  </div>
                  <p className="text-[13px] text-[#231714] mt-0.5 whitespace-pre-wrap">
                    {c.content}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* コメント入力 */}
      <div className="fixed left-0 right-0 max-w-4xl mx-auto bg-white border-t border-gray-200 z-20 safe-area-pb" style={{ bottom: "var(--bottom-nav-height)" }}>
        <div className="px-4 py-2.5 flex items-center gap-2">
          <input
            ref={commentInputRef}
            type="text"
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitComment()}
            placeholder="コメントを入力..."
            maxLength={200}
            className="flex-1 min-w-0 px-3 py-2 text-[16px] bg-gray-50 rounded-full border border-gray-100 focus:outline-none focus:border-[#A5C1C8]"
            style={{ fontSize: "16px" }}
          />
          <button
            onClick={submitComment}
            disabled={!commentText.trim() || sending}
            className="shrink-0 w-9 h-9 rounded-full bg-[#4f757e] text-white disabled:opacity-40 transition-opacity flex items-center justify-center"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 8l5-5v3.5h5a1 1 0 011 1v1a1 1 0 01-1 1H7V13L2 8z" fill="white" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M13 4l-6 6 6 6" stroke="#231714" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function getRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diff = Math.floor((now - then) / 1000);

  if (diff < 60) return "たった今";
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}日前`;
  return new Date(isoString).toLocaleDateString("ja-JP", {
    month: "short",
    day: "numeric",
  });
}
