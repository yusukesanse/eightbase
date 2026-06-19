"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  type CachedPost as Post,
  readPostsCache,
  writePostsCache,
} from "@/lib/timelineCache";

const TABS = [
  { id: "all", label: "すべて" },
  { id: "offer", label: "できます" },
  { id: "request", label: "探してます" },
] as const;

export default function TimelinePage() {
  const router = useRouter();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [currentUserId, setCurrentUserId] = useState("");
  const [hasNew, setHasNew] = useState(false);

  // 表示中の一覧を同期参照するためのref（再取得時の比較に使う）
  const postsRef = useRef<Post[]>([]);
  // 新着がある場合に差し替え待ちの最新一覧を保持
  const pendingRef = useRef<Post[] | null>(null);

  useEffect(() => {
    postsRef.current = posts;
  }, [posts]);

  // 最新一覧を取得して、状況に応じて即時反映 or 新着バナー表示する
  const refresh = useCallback(
    async (force = false) => {
      let fresh: Post[];
      try {
        const res = await fetch("/api/posts", {
          credentials: "include",
          cache: "no-store",
        });
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (!res.ok) return;
        fresh = await res.json();
      } catch {
        return;
      }

      writePostsCache(fresh);
      const prev = postsRef.current;

      // 初回 or 一覧が空のときは無条件で反映（バナーは出さない）
      if (force || prev.length === 0) {
        pendingRef.current = null;
        setHasNew(false);
        setPosts(fresh);
        setLoading(false);
        return;
      }

      // 先頭に未表示の新しい投稿があるか
      const hasNewTop =
        fresh[0] &&
        prev[0] &&
        fresh[0].postId !== prev[0].postId &&
        new Date(fresh[0].createdAt).getTime() >
          new Date(prev[0].createdAt).getTime();

      if (hasNewTop) {
        // 既存一覧は消さず、バナーで通知（押すと差し替え）
        pendingRef.current = fresh;
        setHasNew(true);
      } else {
        // 新着なし: いいね数・コメント数・削除などを裏で静かに反映
        setPosts(fresh);
      }
      setLoading(false);
    },
    [router]
  );

  function showLatest() {
    if (pendingRef.current) {
      setPosts(pendingRef.current);
      pendingRef.current = null;
    }
    setHasNew(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // 初回マウント: キャッシュを即表示しつつ裏で最新取得
  useEffect(() => {
    const cached = readPostsCache();
    const hasCache = !!(cached && cached.length);
    if (hasCache) {
      setPosts(cached!);
      setLoading(false);
    }
    refresh(!hasCache);

    // 自分のuserIdを取得
    fetch("/api/auth/check", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => c?.lineUserId && setCurrentUserId(c.lineUserId))
      .catch(() => {});
  }, [refresh]);

  // ウィンドウ復帰時に裏で再取得
  useEffect(() => {
    const onFocus = () => refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  async function toggleLike(postId: string) {
    try {
      const res = await fetch(`/api/posts/${postId}/like`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return;
      const { liked } = await res.json();

      const next = postsRef.current.map((p) => {
        if (p.postId !== postId) return p;
        const newLikes = liked
          ? [...p.likes, currentUserId]
          : p.likes.filter((id) => id !== currentUserId);
        return { ...p, likes: newLikes };
      });
      setPosts(next);
      writePostsCache(next);
    } catch {
      // ignore
    }
  }

  async function handleDelete(postId: string) {
    if (!confirm("この投稿を削除しますか？")) return;
    try {
      const res = await fetch(`/api/posts/${postId}`, {
        method: "DELETE",
        credentials: "include",
        cache: "no-store",
      });
      if (res.ok) {
        const next = postsRef.current.filter((p) => p.postId !== postId);
        setPosts(next);
        writePostsCache(next);
      } else {
        const data = await res.json();
        alert(data.error || "削除に失敗しました");
      }
    } catch {
      alert("通信エラーが発生しました");
    }
  }

  const filtered =
    activeTab === "all" ? posts : posts.filter((p) => p.type === activeTab);

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <header className="bg-white pt-12 pb-0 px-5">
        <h1 className="text-[17px] font-medium text-[#231714]">掲示板</h1>
      </header>

      {/* タブ */}
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

      {/* 新着バナー */}
      {hasNew && (
        <button
          onClick={showLatest}
          className="fixed top-[92px] left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-full bg-[#A5C1C8] text-white text-xs font-medium shadow-lg flex items-center gap-1.5"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 11V3M3.5 6.5L7 3l3.5 3.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          新しい投稿があります
        </button>
      )}

      {/* 投稿一覧 */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none" className="mb-3 text-gray-200">
            <path d="M5 7h30a2 2 0 012 2v18a2 2 0 01-2 2H11l-6 6V9a2 2 0 012-2z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            <path d="M12 16h16M12 21h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <p className="text-sm text-gray-400">まだ投稿がありません</p>
          <p className="text-xs text-gray-300 mt-1">最初の投稿をしてみましょう</p>
        </div>
      ) : (
        <div className="p-4 space-y-3">
          {filtered.map((post) => (
            <PostCard
              key={post.postId}
              post={post}
              currentUserId={currentUserId}
              onLike={() => toggleLike(post.postId)}
              onClick={() => router.push(`/timeline/${post.postId}`)}
              onDelete={() => handleDelete(post.postId)}
            />
          ))}
        </div>
      )}

      {/* 投稿FAB */}
      <button
        onClick={() => router.push("/timeline/new")}
        className="fixed bottom-24 right-5 w-14 h-14 rounded-full bg-[#A5C1C8] text-white shadow-lg flex items-center justify-center hover:shadow-xl transition-shadow z-20"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M12 5v14M5 12h14" stroke="white" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

function PostCard({
  post,
  currentUserId,
  onLike,
  onClick,
  onDelete,
}: {
  post: Post;
  currentUserId: string;
  onLike: () => void;
  onClick: () => void;
  onDelete: () => void;
}) {
  const liked = post.likes.includes(currentUserId);
  const isOwner = currentUserId === post.authorId;
  const timeAgo = getRelativeTime(post.createdAt);

  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      <button onClick={onClick} className="w-full text-left p-4 pb-2">
        {/* ヘッダー */}
        <div className="flex items-center gap-2.5 mb-2">
          {post.authorPictureUrl ? (
            <img
              src={post.authorPictureUrl}
              alt=""
              className="w-9 h-9 rounded-full object-cover"
            />
          ) : (
            <div className="w-9 h-9 rounded-full bg-[#A5C1C8]/20 flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 2a3 3 0 013 3v0a3 3 0 01-6 0v0a3 3 0 013-3z" stroke="#A5C1C8" strokeWidth="1.2" />
                <path d="M2 14c0-3 2.5-5 6-5s6 2 6 5" stroke="#A5C1C8" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium text-[#231714] truncate">
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
              <span className="text-[10px] text-gray-300">{timeAgo}</span>
            </div>
          </div>
        </div>

        {/* 本文 */}
        <p className="text-[13px] text-[#231714] leading-relaxed whitespace-pre-wrap line-clamp-4">
          {post.content}
        </p>

        {/* タグ */}
        {post.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {post.tags.map((tag) => (
              <span
                key={tag}
                className="text-[10px] text-[#A5C1C8] px-1.5 py-0.5"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </button>

      {/* アクションバー */}
      <div className="flex items-center border-t border-gray-50 px-4 py-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onLike();
          }}
          className="flex items-center gap-1.5 mr-5"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill={liked ? "#F56565" : "none"}>
            <path
              d="M8 14s-5.5-3.5-5.5-7A3 3 0 018 4.5 3 3 0 0113.5 7C13.5 10.5 8 14 8 14z"
              stroke={liked ? "#F56565" : "#ccc"}
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
          </svg>
          <span className={`text-[11px] ${liked ? "text-red-400" : "text-gray-400"}`}>
            {post.likes.length}
          </span>
        </button>
        <button
          onClick={onClick}
          className="flex items-center gap-1.5"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M2 3h12a1 1 0 011 1v7a1 1 0 01-1 1H5l-3 3V4a1 1 0 011-1z"
              stroke="#ccc"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-[11px] text-gray-400">{post.commentCount}</span>
        </button>
        {isOwner && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="flex items-center gap-1 ml-auto"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 5h10M6 5V3.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V5M5 5v8.5a.5.5 0 00.5.5h5a.5.5 0 00.5-.5V5" stroke="#ccc" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-[11px] text-gray-300">削除</span>
          </button>
        )}
      </div>
    </div>
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
