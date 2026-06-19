"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { clearAllCache, getCacheOwner, setCacheOwner } from "@/lib/swrCache";
import { clearPostsCache } from "@/lib/timelineCache";
import { clearEventGoods } from "@/lib/eventGoods";

/**
 * 認証チェックで判明した現在ユーザーと、キャッシュ所有者を突き合わせる。
 * 別ユーザーに変わっていたら前ユーザーの表示キャッシュを破棄してから所有者を更新する。
 * （明示ログアウトを経ずにユーザーが変わったケースの保険）
 */
function reconcileCacheOwner(userId: string) {
  const prev = getCacheOwner();
  if (prev && prev !== userId) {
    clearAllCache();
    clearPostsCache();
    clearEventGoods();
  }
  setCacheOwner(userId);
}

const PUBLIC_PATHS = ["/login", "/", "/setup-profile"];
const PUBLIC_PREFIXES = ["/admin"];

/**
 * セッション中の認証キャッシュ（ページ遷移ごとのAPIコール連打を防ぐための短期メモ）。
 * 認証状態は表示用キャッシュ(swrCache)と同列に扱わない: 表示データより短い TTL にし、
 * すぐに /api/auth/check で取り直す。最終的な可否判定はサーバー側(各API)が担保する。
 */
let authCache: { authorized: boolean; profileComplete: boolean; checkedAt: number } | null = null;
const CACHE_TTL = 60 * 1000; // 認証は短期のみ（60秒）

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "authorized" | "unauthorized">(() => {
    // キャッシュが有効ならloadingをスキップ
    if (authCache && Date.now() - authCache.checkedAt < CACHE_TTL && authCache.authorized) {
      return "authorized";
    }
    return "loading";
  });

  const isPublicPath =
    PUBLIC_PATHS.includes(pathname) ||
    PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  useEffect(() => {
    if (isPublicPath) {
      setStatus("authorized");
      return;
    }

    // キャッシュが有効なら即authorized（プロフィール未完了チェックのみ）
    if (authCache && Date.now() - authCache.checkedAt < CACHE_TTL) {
      if (authCache.authorized) {
        if (!authCache.profileComplete && pathname !== "/setup-profile") {
          router.replace("/setup-profile");
          return;
        }
        setStatus("authorized");
        return;
      }
      setStatus("unauthorized");
      router.replace("/login");
      return;
    }

    setStatus("loading");
    const controller = new AbortController();

    fetch("/api/auth/check", {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          authCache = {
            authorized: !!data.authorized,
            profileComplete: !!data.profileComplete,
            checkedAt: Date.now(),
          };
          if (data.authorized) {
            // ユーザーIDが変わっていたら前ユーザーの表示キャッシュを破棄
            if (data.lineUserId) reconcileCacheOwner(data.lineUserId);
            if (!data.profileComplete && pathname !== "/setup-profile") {
              router.replace("/setup-profile");
              return;
            }
            setStatus("authorized");
          } else {
            setStatus("unauthorized");
            router.replace("/login");
          }
        } else {
          authCache = null;
          setStatus("unauthorized");
          router.replace("/login");
        }
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        authCache = null;
        setStatus("unauthorized");
        router.replace("/login");
      });

    return () => {
      controller.abort();
    };
  }, [isPublicPath, pathname, router]);

  if (status === "loading" && !isPublicPath) {
    // 軽量なスケルトン（フルスクリーンスピナーではない）
    return (
      <div className="min-h-screen bg-gray-50 animate-pulse">
        <div className="h-14 bg-gray-100" />
        <div className="p-4 space-y-3">
          <div className="h-4 bg-gray-100 rounded w-1/3" />
          <div className="h-24 bg-gray-100 rounded-xl" />
          <div className="h-24 bg-gray-100 rounded-xl" />
        </div>
      </div>
    );
  }

  if (status === "unauthorized") return null;

  return <>{children}</>;
}

/** 外部からキャッシュをクリア（ログイン/ログアウトでユーザー切替時に使用） */
export function clearAuthCache() {
  authCache = null;
  // 認証状態が変わるタイミングで表示用クライアントキャッシュも破棄し、
  // 別ユーザーのメンバー一覧・マイページ・掲示板・イベントgood状態が残らないようにする。
  clearAllCache();
  clearPostsCache();
  clearEventGoods();
}
