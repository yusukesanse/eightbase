"use client";

/**
 * stale-while-revalidate な取得を行う小さな汎用 hook。
 *
 * 使い方:
 *   const { data, error, isLoading, isValidating, refresh } =
 *     useStaleWhileRevalidate("members:list", () =>
 *       fetch("/api/members", { credentials: "include", cache: "no-store" })
 *         .then((r) => r.json())
 *     );
 *
 * 挙動:
 *   - マウント時にキャッシュがあれば即 data に入れる（スピナーを避ける）。
 *   - キャッシュが鮮度切れ or 無い場合は裏で fetcher を実行して差し替える。
 *   - 取得失敗時は古い data を保持したまま error だけ立てる（表示は継続）。
 *   - revalidateOnFocus（既定 true）で window focus / visibilitychange でも再取得。
 *
 * ⚠️ 認証状態・予約空き状況・決済系には使わないこと（理由は swrCache.ts 参照）。
 *   それらは従来どおり cache: "no-store" の都度 fetch を使う。
 *
 * 注: まだ全画面には展開していない。使い回せる土台としてのみ用意している。
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  readCache,
  writeCache,
  ttlForKey,
  type CacheStorageKind,
} from "@/lib/swrCache";

// 初回のキャッシュ即表示は paint 前に反映したい（フルスクリーンスピナーの
// 一瞬のちらつきを防ぐ）ので useLayoutEffect を使う。ただし SSR では
// useLayoutEffect が警告を出すため、サーバー側では useEffect にフォールバックする。
// レイアウト副作用はクライアントの初回レンダリング後に走るため、
// サーバーとクライアントの初回描画（=スピナー）は一致し、hydration mismatch にならない。
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export interface UseSwrOptions {
  /** TTL(ms) を明示指定（省略時はキーの名前空間から解決）。 */
  ttl?: number;
  /** session(既定) か local か。判断基準は swrCache.ts のコメント参照。 */
  storage?: CacheStorageKind;
  /** window 復帰時に再取得するか（既定 true）。 */
  revalidateOnFocus?: boolean;
}

export interface UseSwrResult<T> {
  data: T | undefined;
  error: unknown;
  /** 初回かつキャッシュ無しで取得中のときだけ true。 */
  isLoading: boolean;
  /** 裏で再取得中（古い表示を出したまま）。 */
  isValidating: boolean;
  /** 手動で再取得する。 */
  refresh: () => Promise<void>;
}

export function useStaleWhileRevalidate<T>(
  // null を渡すと無効化（条件付き取得に使える）
  key: string | null,
  fetcher: () => Promise<T>,
  options?: UseSwrOptions
): UseSwrResult<T> {
  const { storage = "session", revalidateOnFocus = true } = options ?? {};
  const ttl = options?.ttl ?? (key ? ttlForKey(key) : 0);

  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(!!key);
  const [isValidating, setIsValidating] = useState<boolean>(false);

  // fetcher は毎レンダリングで新しい関数になりがちなので ref で保持し、
  // 依存配列には key だけを入れて無限ループを避ける。
  // ⚠️ 必ず layout effect で更新すること（下の「初回/キー変更」layout effect より先に走らせる）。
  // 普通の useEffect にすると、キーが変わったレンダリングの初回取得が「前のレンダリングの
  // 古いクロージャ」で実行される（例: 予約画面で日付選択直後に selectedDate=null のまま
  // 空き取得 → 空配列が新キーのキャッシュに保存され、予約済み時間帯が空きに見える）。
  const fetcherRef = useRef(fetcher);
  useIsomorphicLayoutEffect(() => {
    fetcherRef.current = fetcher;
  });

  // 多重実行防止
  const inFlightRef = useRef(false);

  const revalidate = useCallback(async () => {
    if (!key || inFlightRef.current) return;
    inFlightRef.current = true;
    setIsValidating(true);
    try {
      const fresh = await fetcherRef.current();
      writeCache<T>(key, fresh, { storage });
      setData(fresh);
      setError(undefined);
    } catch (e) {
      // 古い data があれば表示継続。error だけ立てる。
      setError(e);
    } finally {
      inFlightRef.current = false;
      setIsValidating(false);
      setIsLoading(false);
    }
  }, [key, storage]);

  // 初回 / key 変更時: キャッシュ即表示 + 必要なら裏で再取得
  useIsomorphicLayoutEffect(() => {
    if (!key) {
      setData(undefined);
      setIsLoading(false);
      return;
    }
    const cached = readCache<T>(key, { storage, ttl });
    if (cached) {
      setData(cached.data);
      setIsLoading(false);
      // 鮮度切れのときだけ裏で取り直す（鮮度内なら無駄打ちしない）。
      if (cached.isStale) void revalidate();
    } else {
      setIsLoading(true);
      void revalidate();
    }
    // ttl/storage は key に紐づくため key の変化だけ見れば十分
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, revalidate]);

  // window 復帰時の再取得
  useEffect(() => {
    if (!key || !revalidateOnFocus) return;
    const onFocus = () => void revalidate();
    const onVisible = () => {
      if (document.visibilityState === "visible") void revalidate();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key, revalidateOnFocus, revalidate]);

  return { data, error, isLoading, isValidating, refresh: revalidate };
}
