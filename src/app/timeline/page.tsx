"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  type CachedPost as Post,
  readPostsCache,
  writePostsCache,
} from "@/lib/timelineCache";
import { openExternalUrl } from "@/lib/liff";
import { BottomSheet } from "@/components/ui/Sheet";
import { Avatar, SheetButton } from "@/components/ui/LineContact";

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

  // 新規投稿シート
  const [composeOpen, setComposeOpen] = useState(false);
  const [draftType, setDraftType] = useState<"offer" | "request">("offer");
  const [draftBody, setDraftBody] = useState("");
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function addTag() {
    const t = tagInput.trim();
    if (t && !draftTags.includes(t) && draftTags.length < 5) {
      setDraftTags((prev) => [...prev, t]);
      setTagInput("");
    }
  }
  function removeTag(t: string) {
    setDraftTags((prev) => prev.filter((x) => x !== t));
  }

  // 詳細シート対象
  const [open, setOpen] = useState<Post | null>(null);

  const postsRef = useRef<Post[]>([]);
  useEffect(() => {
    postsRef.current = posts;
  }, [posts]);

  // 最新一覧を取得（前回表示を消さず裏で差し替え）
  const refresh = useCallback(
    async (force = false) => {
      let fresh: Post[];
      try {
        const res = await fetch("/api/posts", { credentials: "include", cache: "no-store" });
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
      setPosts(fresh);
      setLoading(false);
      void force;
    },
    [router]
  );

  // 初回: キャッシュ即表示しつつ裏で取得
  useEffect(() => {
    const cached = readPostsCache();
    if (cached && cached.length) {
      setPosts(cached);
      setLoading(false);
    }
    refresh(!(cached && cached.length));

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

  async function submitPost() {
    if (!draftBody.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: draftType, content: draftBody.trim(), tags: draftTags }),
      });
      if (res.ok) {
        setComposeOpen(false);
        setDraftBody("");
        setDraftType("offer");
        setDraftTags([]);
        setTagInput("");
        await refresh(true);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        const d = await res.json().catch(() => ({}));
        alert(d.error || "投稿に失敗しました");
      }
    } catch {
      alert("通信エラーが発生しました");
    } finally {
      setSubmitting(false);
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
        closeAll();
      } else {
        const data = await res.json();
        alert(data.error || "削除に失敗しました");
      }
    } catch {
      alert("通信エラーが発生しました");
    }
  }

  function openPost(p: Post) {
    setOpen(p);
  }
  function closeAll() {
    setOpen(null);
  }

  const filtered = activeTab === "all" ? posts : posts.filter((p) => p.type === activeTab);

  return (
    <div className="min-h-screen pb-20" style={{ background: "#f3f5f6" }}>
      {/* 見出し */}
      <div className="px-5 pt-12 pb-2.5">
        <h1 className="text-[22px] font-bold text-[#1c1f21]">掲示板</h1>
      </div>

      {/* タブ（下線） */}
      <div className="flex gap-5 px-5 border-b border-[#eceff1] bg-[#f3f5f6] sticky top-0 z-10">
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative py-3 text-[14px] font-medium transition-colors ${
                active ? "text-[#1c1f21]" : "text-[#6b6e73]"
              }`}
            >
              {tab.label}
              {active && <span className="absolute left-0 right-0 bottom-0 h-[2px] rounded-full bg-[#a5c1c7]" />}
            </button>
          );
        })}
      </div>

      {/* 一覧 */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-[#a5c1c7] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-[14px] text-[#6b6e73]">まだ投稿がありません</p>
          <p className="text-[12px] text-[#c3c7cc] mt-1">最初の投稿をしてみましょう</p>
        </div>
      ) : (
        <div className="px-5 pt-4 pb-7 flex flex-col gap-3">
          {filtered.map((post) => (
            <PostCard
              key={post.postId}
              post={post}
              liked={post.likes.includes(currentUserId)}
              onLike={() => toggleLike(post.postId)}
              onOpen={() => openPost(post)}
            />
          ))}
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => {
          setDraftType("offer");
          setDraftBody("");
          setDraftTags([]);
          setTagInput("");
          setComposeOpen(true);
        }}
        aria-label="投稿する"
        className="fixed right-5 w-14 h-14 rounded-full text-white flex items-center justify-center z-20 active:scale-[0.92] transition-transform"
        style={{ bottom: "calc(var(--bottom-nav-height) + 16px)", background: "#a5c1c7", boxShadow: "0 6px 16px rgba(28,31,33,.18)" }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M12 5v14M5 12h14" stroke="white" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {/* 新規投稿シート */}
      <BottomSheet
        open={composeOpen}
        title="新規投稿"
        onClose={() => setComposeOpen(false)}
        footer={
          <>
            <SheetButton variant="secondary" onClick={() => setComposeOpen(false)}>キャンセル</SheetButton>
            <SheetButton onClick={submitPost} disabled={!draftBody.trim() || submitting}>
              {submitting ? "投稿中…" : "投稿する"}
            </SheetButton>
          </>
        }
      >
        <div className="flex flex-col gap-3.5">
          <div className="flex gap-1 p-1 rounded-xl bg-[#f6f8f9]">
            {([
              { id: "offer", label: "できます" },
              { id: "request", label: "探してます" },
            ] as const).map((s) => (
              <button
                key={s.id}
                onClick={() => setDraftType(s.id)}
                className={`flex-1 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                  draftType === s.id ? "bg-white text-[#1c1f21] shadow-sm" : "text-[#6d6f74]"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <textarea
            rows={3}
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            maxLength={500}
            placeholder="いまできること・探していることを書こう"
            style={{ fontSize: "16px" }}
            className="w-full px-3 py-2.5 text-[15px] leading-relaxed text-[#1c1f21] bg-white rounded-[10px] border border-[#e4e7e9] focus:outline-none focus:border-[#a5c1c7] resize-none"
          />

          {/* タグ（最大5個） */}
          <div>
            <p className="text-[12px] text-[#6d6f74] mb-2">タグ（最大5個）</p>
            {draftTags.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {draftTags.map((t) => (
                  <button
                    key={t}
                    onClick={() => removeTag(t)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] rounded-full bg-[#eef4f5] text-[#5f7a80]"
                  >
                    #{t}
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="#5f7a80" strokeWidth="1.3" strokeLinecap="round" />
                    </svg>
                  </button>
                ))}
              </div>
            )}
            {draftTags.length < 5 && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder="タグを入力"
                  className="flex-1 px-3 py-2 text-[13px] bg-white rounded-[10px] border border-[#e4e7e9] focus:outline-none focus:border-[#a5c1c7]"
                />
                <button
                  onClick={addTag}
                  disabled={!tagInput.trim()}
                  className="px-3.5 py-2 text-[12px] rounded-[10px] bg-[#f6f8f9] text-[#40434a] disabled:opacity-40"
                >
                  追加
                </button>
              </div>
            )}
          </div>
        </div>
      </BottomSheet>

      {/* 投稿詳細シート */}
      <BottomSheet
        open={!!open}
        title="投稿の詳細"
        onClose={closeAll}
        footer={
          <>
            <SheetButton variant="secondary" onClick={closeAll}>閉じる</SheetButton>
            <SheetButton
              line
              disabled={!open?.authorLineUrl}
              onClick={() => open?.authorLineUrl && openExternalUrl(open.authorLineUrl)}
            >
              LINEで連絡
            </SheetButton>
          </>
        }
      >
        {open && (
          <div className="flex flex-col gap-3.5">
            <PostHeader post={open} large />
            <div className="text-[15px] text-[#40434a] leading-[1.75] whitespace-pre-wrap">{open.content}</div>
            {open.tags.length > 0 && (
              <div className="flex flex-wrap gap-2.5">
                {open.tags.map((t) => (
                  <span key={t} className="text-[13px] font-medium text-[#3f7c98]">#{t}</span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-[18px] pt-3 border-t border-[#eceff1]">
              <LikeStat count={open.likes.length} active={open.likes.includes(currentUserId)} />
            </div>
            {!open.authorLineUrl && (
              <p className="text-[12px] text-[#6b6e73] leading-relaxed">
                投稿者がLINE連絡先（友だち追加URL）を未登録のため、「LINEで連絡」はご利用いただけません。
              </p>
            )}

            {currentUserId && open.authorId === currentUserId && (
              <button
                onClick={() => handleDelete(open.postId)}
                className="self-start text-[12px] text-[#d82328] mt-1"
              >
                この投稿を削除
              </button>
            )}
          </div>
        )}
      </BottomSheet>
    </div>
  );
}

/* ── 投稿ヘッダー（アバター + 氏名 + 状態バッジ + 時刻） ── */
function PostHeader({ post, large }: { post: Post; large?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <Avatar src={post.authorPictureUrl} name={post.authorName} size={large ? "md" : "sm"} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`font-bold text-[#1c1f21] ${large ? "text-[16px]" : "text-[15px]"}`}>{post.authorName}</span>
          <StatusBadge type={post.type} />
        </div>
        <div className="text-[12px] text-[#6b6e73]">{getRelativeTime(post.createdAt)}</div>
      </div>
    </div>
  );
}

function StatusBadge({ type }: { type: "offer" | "request" }) {
  const offer = type === "offer";
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold"
      style={offer ? { background: "#eef4dd", color: "#6f9023" } : { background: "#eef4f5", color: "#5f7a80" }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: offer ? "#8aab36" : "#a5c1c7" }} />
      {offer ? "できます" : "探してます"}
    </span>
  );
}

/* ── 投稿カード ── */
function PostCard({
  post,
  liked,
  onLike,
  onOpen,
}: {
  post: Post;
  liked: boolean;
  onLike: () => void;
  onOpen: () => void;
}) {
  return (
    <div
      onClick={onOpen}
      className="bg-white rounded-[18px] p-4 cursor-pointer active:scale-[0.99] transition-transform"
      style={{ boxShadow: "0 1px 3px rgba(28,31,33,.05), 0 6px 16px rgba(28,31,33,.05)" }}
    >
      <PostHeader post={post} />
      <div className="text-[15px] text-[#40434a] leading-[1.7] mt-2.5 whitespace-pre-wrap line-clamp-4">
        {post.content}
      </div>
      {post.tags.length > 0 && (
        <div className="flex flex-wrap gap-2.5 mt-2">
          {post.tags.map((t) => (
            <span key={t} className="text-[13px] font-medium text-[#3f7c98]">#{t}</span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-[18px] mt-3">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onLike();
          }}
        >
          <LikeStat count={post.likes.length} active={liked} />
        </button>
        <span className="ml-auto inline-flex items-center gap-1 text-[12px] text-[#6b6e73]">
          詳細
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </span>
      </div>
    </div>
  );
}

function LikeStat({ count, active }: { count: number; active?: boolean }) {
  const color = active ? "#e5484d" : "#6d6f74";
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold" style={{ color }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? "#e5484d" : "none"} stroke={active ? "#e5484d" : "#6b6e73"} strokeWidth={active ? 2.4 : 1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 21s-7-4.35-9.5-8.5C1 9 3 5.5 6.5 5.5c2 0 3.5 1.2 5.5 3.5 2-2.3 3.5-3.5 5.5-3.5C21 5.5 23 9 21.5 12.5 19 16.65 12 21 12 21z" />
      </svg>
      <span>{count}</span>
    </span>
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
  return new Date(isoString).toLocaleDateString("ja-JP", { month: "short", day: "numeric" });
}
