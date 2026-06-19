/**
 * 掲示板（timeline）の投稿一覧を sessionStorage に保持する軽量クライアントキャッシュ。
 *
 * 目的: 画面を開くたびに空白/スピナーになるのを避け、前回表示を即出ししつつ
 * 裏で最新を再取得する（X 風の UX）。
 */

export interface CachedPost {
  postId: string;
  authorId: string;
  authorName: string;
  authorPictureUrl: string;
  type: "offer" | "request";
  content: string;
  tags: string[];
  likes: string[];
  commentCount: number;
  createdAt: string;
}

const CACHE_KEY = "timeline_posts_v1";

export function readPostsCache(): CachedPost[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CachedPost[]) : null;
  } catch {
    return null;
  }
}

export function writePostsCache(posts: CachedPost[]): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(posts));
  } catch {
    // quota 超過などは無視
  }
}

/** 新規投稿後などに、先頭へ即時反映する（同一 postId は重複させない）。 */
export function prependPostCache(post: CachedPost): void {
  const current = readPostsCache() || [];
  writePostsCache([post, ...current.filter((p) => p.postId !== post.postId)]);
}

export function findCachedPost(postId: string): CachedPost | null {
  const current = readPostsCache();
  return current?.find((p) => p.postId === postId) || null;
}

/** 掲示板キャッシュを破棄する（ログイン/ログアウトでユーザー切替時に呼ぶ）。 */
export function clearPostsCache(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    // 無視
  }
}
