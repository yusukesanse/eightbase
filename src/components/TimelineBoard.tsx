"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import {
  type CachedPost as Post,
  readPostsCache,
  writePostsCache,
} from "@/lib/timelineCache";
import { openExternalUrl } from "@/lib/liff";
import { BottomSheet } from "@/components/ui/Sheet";
import { Avatar, SheetButton } from "@/components/ui/LineContact";
import { Button, GlassCard, PageBg, PageHeading, SegmentedTabs, StatusPill, inputClass, type EbStatusTone } from "@/components/ui/eb";

/**
 * 掲示板（できます/探してます）本体。E-1 で /timeline ページと Info の「掲示板」タブの両方から使う。
 * embedded=true（Info タブ内）では外枠・見出し・sticky を外す（Info 側の枠に収める）。
 */

const TABS = [
  { id: "all", label: "すべて" },
  { id: "offer", label: "できます" },
  { id: "request", label: "探してます" },
] as const;

const TYPE_CONFIG: Record<"offer" | "request", { tone: EbStatusTone; label: string }> = {
  offer: { tone: "green", label: "できます" },
  request: { tone: "gold", label: "探してます" },
};

export function TimelineBoard({ embedded = false }: { embedded?: boolean }) {
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

  const inner = (
    <>
      {/* 見出し（スタンドアロン /timeline のみ。Info タブ内では省略） */}
      {!embedded && (
        <div className="px-5 pt-[52px]">
          <PageHeading title="掲示板" subtitle="できます・探してます" />
        </div>
      )}

      {/* タブ。埋め込み時は Info のタブバーと二重 sticky を避けるため sticky を外す。 */}
      <div
        className={clsx("px-5", embedded ? "pt-4" : "sticky top-0 z-10 pt-4 pb-1")}
        style={!embedded ? { background: "var(--eb-bg)" } : undefined}
      >
        <SegmentedTabs
          items={TABS.map((t) => ({ id: t.id, label: t.label }))}
          value={activeTab}
          onChange={setActiveTab}
          size="md"
        />
      </div>

      {/* 一覧 */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div
            className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
            style={{ borderColor: "var(--eb-green)", borderTopColor: "transparent" }}
          />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-[15px] text-[color:var(--eb-ink)]">まだ投稿がありません</p>
          <p className="mt-1 text-[13px] text-[color:var(--eb-ink-muted)]">最初の投稿をしてみましょう</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 px-5 pb-7 pt-4">
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
        className="fixed right-5 z-20 flex h-14 w-14 items-center justify-center rounded-full text-white transition-transform active:scale-[0.92]"
        style={{
          bottom: "calc(var(--bottom-nav-height) + 16px)",
          background: "var(--eb-green)",
          boxShadow: "0 6px 16px rgba(20,41,31,.24)",
        }}
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
          <div className="flex gap-2">
            {([
              { id: "offer", label: "できます" },
              { id: "request", label: "探してます" },
            ] as const).map((s) => {
              const selected = draftType === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setDraftType(s.id)}
                  className={clsx(
                    "h-12 flex-1 rounded-[14px] text-[14px] font-bold transition-colors",
                    selected ? "border-2 text-white" : "border bg-white/60 text-[color:var(--eb-ink)]"
                  )}
                  style={
                    selected
                      ? { background: "var(--eb-green)", borderColor: "var(--eb-green)" }
                      : { borderColor: "var(--eb-line)" }
                  }
                >
                  {s.label}
                </button>
              );
            })}
          </div>
          <textarea
            rows={3}
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            maxLength={500}
            placeholder="いまできること・探していることを書こう"
            style={{ fontSize: "16px" }}
            className="h-40 w-full resize-none rounded-2xl border border-[color:var(--eb-line)] bg-white px-4 py-3 text-[15px] leading-relaxed text-[color:var(--eb-ink)] focus:outline-none focus:border-2 focus:border-[color:var(--eb-green)]"
          />

          {/* タグ（最大5個） */}
          <div>
            <p className="mb-2 text-[12px] text-[color:var(--eb-ink-muted)]">タグ（最大5個）</p>
            {draftTags.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {draftTags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => removeTag(t)}
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-bold"
                    style={{ background: "rgba(35,147,94,.14)", color: "var(--eb-green-text)" }}
                  >
                    #{t}
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
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
                  className={clsx("flex-1", inputClass)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  fullWidth={false}
                  className="w-20"
                  disabled={!tagInput.trim()}
                  onClick={addTag}
                >
                  追加
                </Button>
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
            <div className="whitespace-pre-wrap text-[15px] leading-[1.75] text-[color:var(--eb-ink)]">{open.content}</div>
            {open.tags.length > 0 && (
              <div className="flex flex-wrap gap-2.5">
                {open.tags.map((t) => (
                  <span key={t} className="text-[13px] font-bold text-[color:var(--eb-green-text)]">#{t}</span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-[18px] border-t border-[color:var(--eb-line)] pt-3">
              <LikeStat count={open.likes.length} active={open.likes.includes(currentUserId)} />
            </div>
            {!open.authorLineUrl && (
              <p className="text-[12px] leading-relaxed text-[color:var(--eb-ink-muted)]">
                投稿者がLINE連絡先（友だち追加URL）を未登録のため、「LINEで連絡」はご利用いただけません。
              </p>
            )}

            {currentUserId && open.authorId === currentUserId && (
              <button
                onClick={() => handleDelete(open.postId)}
                className="mt-1 self-start text-[12px] text-[color:var(--eb-coral-text)]"
              >
                この投稿を削除
              </button>
            )}
          </div>
        )}
      </BottomSheet>
    </>
  );

  if (embedded) return <div className="pb-20">{inner}</div>;
  return <PageBg>{inner}</PageBg>;
}

/* ── 投稿ヘッダー（アバター + 氏名 + 状態バッジ + 時刻） ── */
function PostHeader({ post, large }: { post: Post; large?: boolean }) {
  const cfg = TYPE_CONFIG[post.type];
  return (
    <div className="flex items-center gap-2.5">
      <Avatar src={post.authorPictureUrl} name={post.authorName} size={large ? "md" : "sm"} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={clsx("font-bold text-[color:var(--eb-ink)]", large ? "text-[16px]" : "text-[15px]")}>{post.authorName}</span>
          <StatusPill tone={cfg.tone}>{cfg.label}</StatusPill>
        </div>
        <div className="text-[12px] text-[color:var(--eb-ink-muted)]">{getRelativeTime(post.createdAt)}</div>
      </div>
    </div>
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
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
      className="cursor-pointer active:opacity-90"
    >
      <GlassCard>
        <PostHeader post={post} />
        <div className="mt-2.5 line-clamp-4 whitespace-pre-wrap text-[15px] leading-[1.7] text-[color:var(--eb-ink)]">
          {post.content}
        </div>
        {post.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2.5">
            {post.tags.map((t) => (
              <span key={t} className="text-[13px] font-bold text-[color:var(--eb-green-text)]">#{t}</span>
            ))}
          </div>
        )}
        <div className="mt-3 flex items-center gap-3">
          <LikeButton
            count={post.likes.length}
            active={liked}
            onClick={(e) => {
              e.stopPropagation();
              onLike();
            }}
          />
          <span className="ml-auto inline-flex items-center gap-1 text-[12px] text-[color:var(--eb-ink-muted)]">
            詳細
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </span>
        </div>
      </GlassCard>
    </div>
  );
}

/** カード上のいいね（44px 丸ボタン＋件数）。 */
function LikeButton({
  count,
  active,
  onClick,
}: {
  count: number;
  active: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        aria-label={active ? "いいねを取り消す" : "いいね"}
        aria-pressed={active}
        className="flex h-11 w-11 items-center justify-center rounded-full transition-transform active:scale-90"
        style={{ background: active ? "rgba(217,72,58,.14)" : "var(--eb-tint)" }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill={active ? "var(--eb-coral)" : "none"}
          stroke={active ? "var(--eb-coral)" : "var(--eb-ink-muted)"}
          strokeWidth={active ? 2.2 : 1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 21s-7-4.35-9.5-8.5C1 9 3 5.5 6.5 5.5c2 0 3.5 1.2 5.5 3.5 2-2.3 3.5-3.5 5.5-3.5C21 5.5 23 9 21.5 12.5 19 16.65 12 21 12 21z" />
        </svg>
      </button>
      <span
        className="text-[13px] font-bold tabular-nums"
        style={{ color: active ? "var(--eb-coral-text)" : "var(--eb-ink-muted)" }}
      >
        {count}
      </span>
    </div>
  );
}

/** 詳細シートの静的ないいね表示（タップ不可）。 */
function LikeStat({ count, active }: { count: number; active?: boolean }) {
  const color = active ? "var(--eb-coral-text)" : "var(--eb-ink-muted)";
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-bold" style={{ color }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? "var(--eb-coral)" : "none"} stroke={active ? "var(--eb-coral)" : "var(--eb-ink-muted)"} strokeWidth={active ? 2.4 : 1.8} strokeLinecap="round" strokeLinejoin="round">
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
