"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { type CachedPost as Post, findCachedPost } from "@/lib/timelineCache";
import { Avatar } from "@/components/ui/LineContact";
import { GlassCard, PageBg, StatusPill, type EbStatusTone } from "@/components/ui/eb";

interface Comment {
  commentId: string;
  authorId: string;
  authorName: string;
  authorPictureUrl: string;
  content: string;
  createdAt: string;
}

const TYPE_CONFIG: Record<"offer" | "request", { tone: EbStatusTone; label: string }> = {
  offer: { tone: "green", label: "できます" },
  request: { tone: "gold", label: "探してます" },
};

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <PageBg className="flex items-center justify-center">
        <div
          className="h-10 w-10 animate-spin rounded-full border-2 border-t-transparent"
          style={{ borderColor: "var(--eb-green)", borderTopColor: "transparent" }}
        />
      </PageBg>
    );
  }

  if (!post) {
    return (
      <PageBg>
        <header className="flex items-center gap-3 px-5 pt-[52px] pb-4">
          <button onClick={() => router.back()} className="p-1">
            <BackIcon />
          </button>
          <h1 className="text-[16px] font-bold text-[color:var(--eb-ink)]">投稿</h1>
        </header>
        <div className="flex flex-col items-center justify-center py-20">
          <p className="text-[15px] text-[color:var(--eb-ink-muted)]">投稿が見つかりません</p>
        </div>
      </PageBg>
    );
  }

  const liked = post.likes.includes(currentUserId);
  const typeCfg = TYPE_CONFIG[post.type];

  return (
    <PageBg>
      {/* ヘッダー */}
      <header className="flex items-center gap-3 px-5 pt-[52px] pb-4">
        <button onClick={() => router.back()} className="p-1">
          <BackIcon />
        </button>
        <h1 className="flex-1 text-[16px] font-bold text-[color:var(--eb-ink)]">投稿</h1>
        {isOwner && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-2 py-1 text-[13px] font-bold text-[color:var(--eb-coral-text)] disabled:opacity-50"
          >
            {deleting ? "削除中..." : "削除"}
          </button>
        )}
      </header>

      {/* 投稿本文 */}
      <div className="px-5 pb-4">
        <GlassCard>
          <div className="mb-3 flex items-center gap-2.5">
            <Avatar src={post.authorPictureUrl} name={post.authorName} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold text-[color:var(--eb-ink)]">
                {post.authorName}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <StatusPill tone={typeCfg.tone}>{typeCfg.label}</StatusPill>
                <span className="text-[12px] text-[color:var(--eb-ink-muted)]">
                  {getRelativeTime(post.createdAt)}
                </span>
              </div>
            </div>
          </div>

          <p className="whitespace-pre-wrap text-[15px] leading-[1.7] text-[color:var(--eb-ink)]">
            {post.content}
          </p>

          {post.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2.5">
              {post.tags.map((tag) => (
                <span key={tag} className="text-[13px] font-bold text-[color:var(--eb-green-text)]">
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {/* アクションバー */}
          <div className="mt-4 flex items-center gap-5 border-t border-[color:var(--eb-line)] pt-3">
            <button onClick={toggleLike} className="flex items-center gap-1.5">
              <svg width="18" height="18" viewBox="0 0 18 18" fill={liked ? "var(--eb-coral)" : "none"}>
                <path
                  d="M9 16s-6.5-4-6.5-8A3.5 3.5 0 019 5a3.5 3.5 0 016.5 3c0 4-6.5 8-6.5 8z"
                  stroke={liked ? "var(--eb-coral)" : "var(--eb-ink-muted)"}
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="text-[13px] font-bold" style={{ color: liked ? "var(--eb-coral-text)" : "var(--eb-ink-muted)" }}>
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
                  stroke="var(--eb-ink-muted)"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="text-[13px] font-bold text-[color:var(--eb-ink-muted)]">
                {comments.length}
              </span>
            </button>
          </div>
        </GlassCard>
      </div>

      {/* コメント一覧 */}
      {comments.length > 0 && (
        <div className="px-5 pb-4">
          <p className="mb-2 text-[13px] font-bold text-[color:var(--eb-ink-muted)]">コメント</p>
          <div className="flex flex-col gap-2.5">
            {comments.map((c) => (
              <GlassCard key={c.commentId} padding="md">
                <div className="flex items-start gap-2.5">
                  <Avatar src={c.authorPictureUrl} name={c.authorName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-bold text-[color:var(--eb-ink)]">
                        {c.authorName}
                      </span>
                      <span className="text-[11px] text-[color:var(--eb-ink-muted)]">
                        {getRelativeTime(c.createdAt)}
                      </span>
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap text-[14px] text-[color:var(--eb-ink)]">
                      {c.content}
                    </p>
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        </div>
      )}

      <div className="h-24" />

      {/* コメント入力 */}
      <div
        className="fixed inset-x-0 z-20 mx-auto max-w-4xl border-t border-[color:var(--eb-line)] safe-area-pb"
        style={{ bottom: "var(--bottom-nav-height)", background: "rgba(255,255,255,.96)" }}
      >
        <div className="flex items-center gap-2 px-4 py-2.5">
          <input
            ref={commentInputRef}
            type="text"
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitComment()}
            placeholder="コメントを入力..."
            maxLength={200}
            style={{ fontSize: "16px" }}
            className="min-w-0 flex-1 rounded-full border border-[color:var(--eb-line)] bg-white px-4 py-2.5 text-[15px] text-[color:var(--eb-ink)] focus:outline-none focus:border-2 focus:border-[color:var(--eb-green)]"
          />
          <button
            onClick={submitComment}
            disabled={!commentText.trim() || sending}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition-opacity disabled:opacity-40"
            style={{ background: "var(--eb-green)" }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 8l5-5v3.5h5a1 1 0 011 1v1a1 1 0 01-1 1H7V13L2 8z" fill="white" />
            </svg>
          </button>
        </div>
      </div>
    </PageBg>
  );
}

function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M13 4l-6 6 6 6" stroke="var(--eb-ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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
