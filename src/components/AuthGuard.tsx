"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { clearAllCache, getCacheOwner, setCacheOwner } from "@/lib/swrCache";
import { clearPostsCache } from "@/lib/timelineCache";
import { clearEventGoods } from "@/lib/eventGoods";
import { clearReservationDraft } from "@/lib/reservationDraft";
import { isGamesOnlyRole, normalizeRole, type UserRole } from "@/lib/roles";
import { paymentReturnSearch, GAME_PAYMENT_RETURN_BASE } from "@/lib/gamePaymentReturn";
import { isDevLoginEnabled } from "@/lib/env";
import { AuthRecovery } from "./AuthRecovery";

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
    clearReservationDraft();
  }
  setCacheOwner(userId);
}

const PUBLIC_PATHS = ["/login", "/", "/guest"];
const PUBLIC_PREFIXES = ["/admin"];

/**
 * 未認証時の遷移先。本番は `/login`。
 * DEV-ONLY 分岐（develop 専用）: 開発は `/` へ送り固定ロールで自動ログインさせる。
 */
function loginPath(): string {
  const path = isDevLoginEnabled() ? "/" : "/login";
  return `${path}${typeof window === "undefined" ? "" : paymentReturnSearch(window.location.search)}`;
}

/** ゲスト(role=guest)が閲覧できるのはゲーム機能のみ。会員専用ルート（/info・掲示板等）はブロック。 */
function isGuestAllowedPath(pathname: string): boolean {
  // E-1: ゲームは独立導線 /games に集約（/info は会員専用の イベント/ニュース/掲示板 になった）。
  return pathname.startsWith(GAME_PAYMENT_RETURN_BASE);
}
/** ゲストの初期到達先（全ゲームのハブ=/games）。 */
const GUEST_HOME = GAME_PAYMENT_RETURN_BASE;

/**
 * ゲーム限定ロールを許可パスへ送り返すときの遷移先。
 *
 * ⚠️ **決済戻りのクエリを必ず引き継ぐこと。**
 *    2026-08-03 の本番障害はここで `router.replace("/games")` とクエリを捨てていたのが原因。
 *    Square が会員専用の `/info?dartspay=<id>` へ戻していたため、ゲストだけが弾かれて
 *    `?dartspay=` を失い、確定APIが呼ばれず「払ったのに未払い」になった。
 *    現在は戻り先を `/games` にしたが、**発行済みで未確定の古い決済リンク**が `/info` を
 *    指したまま残るので、この引き継ぎが救済経路になる。
 */
function gamesOnlyRedirectTarget(): string {
  const search = typeof window === "undefined" ? "" : paymentReturnSearch(window.location.search);
  return `${GUEST_HOME}${search}`;
}

/**
 * セッション中の認証キャッシュ（ページ遷移ごとのAPIコール連打を防ぐための短期メモ）。
 * 認証状態は表示用キャッシュ(swrCache)と同列に扱わない: 表示データより短い TTL にし、
 * すぐに /api/auth/check で取り直す。最終的な可否判定はサーバー側(各API)が担保する。
 */
let authCache: { authorized: boolean; profileComplete: boolean; role: UserRole; checkedAt: number } | null = null;
const CACHE_TTL = 60 * 1000; // 認証は短期のみ（60秒）

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [checkedPath, setCheckedPath] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "authorized" | "unauthorized" | "error">(() => {
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
      // 同じ保護ページにログインから戻る場合も、以前の許可状態を再利用しない。
      setCheckedPath(null);
      setStatus("authorized");
      return;
    }
    setCheckedPath(pathname);
    setStatus("loading");

    // キャッシュが有効なら即authorized（ゲスト/プロフィール未完了の分岐のみ）
    if (authCache && Date.now() - authCache.checkedAt < CACHE_TTL) {
      if (authCache.authorized) {
        if (isGamesOnlyRole(authCache.role)) {
          // ゲストはゲーム系のみ。会員用プロフィール画面には入れない。
          if (!isGuestAllowedPath(pathname)) {
            router.replace(gamesOnlyRedirectTarget());
            return;
          }
          setStatus("authorized");
          return;
        }
        if (!authCache.profileComplete && pathname !== "/setup-profile") {
          router.replace("/setup-profile");
          return;
        }
        setStatus("authorized");
        return;
      }
      setStatus("unauthorized");
      return;
    }

    setStatus("loading");
    const controller = new AbortController();

    fetch("/api/auth/check", {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (res) => {
        if (controller.signal.aborted) return;
        if (res.ok) {
          const data = await res.json();
          if (controller.signal.aborted) return;
          authCache = {
            authorized: !!data.authorized,
            profileComplete: !!data.profileComplete,
            role: normalizeRole(data.role),
            checkedAt: Date.now(),
          };
          if (data.authorized) {
            // ユーザーIDが変わっていたら前ユーザーの表示キャッシュを破棄
            if (data.lineUserId) reconcileCacheOwner(data.lineUserId);
            if (isGamesOnlyRole(authCache.role)) {
              // ゲストはゲーム系のみ。会員用プロフィール画面には入れない。
              if (!isGuestAllowedPath(pathname)) {
                router.replace(gamesOnlyRedirectTarget());
                return;
              }
              setStatus("authorized");
              return;
            }
            if (!data.profileComplete && pathname !== "/setup-profile") {
              router.replace("/setup-profile");
              return;
            }
            setStatus("authorized");
          } else {
            setStatus("unauthorized");
          }
        } else {
          authCache = null;
          setStatus(res.status === 401 || res.status === 403 ? "unauthorized" : "error");
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        authCache = null;
        setStatus("error");
      });

    return () => {
      controller.abort();
    };
  }, [isPublicPath, pathname, router, attempt]);

  if (!isPublicPath && (status === "loading" || checkedPath !== pathname)) {
    // 軽量なスケルトン（フルスクリーンスピナーではない）
    return (
      <div className="min-h-screen bg-[#F3F6F4] animate-pulse" role="status" aria-label="認証を確認しています">
        <div className="h-14 bg-gray-100" />
        <div className="p-4 space-y-3">
          <div className="h-4 bg-gray-100 rounded w-1/3" />
          <div className="h-24 bg-gray-100 rounded-xl" />
          <div className="h-24 bg-gray-100 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!isPublicPath && (status === "unauthorized" || status === "error")) {
    const needsLogin = status === "unauthorized";
    return (
      <AuthRecovery
        title={needsLogin ? "ログインが必要です" : "接続を確認できませんでした"}
        message={needsLogin
          ? "ログイン状態を確認できませんでした。下のボタンからもう一度ログインしてください。"
          : "通信状況を確認して、もう一度お試しください。"}
        retryLabel={needsLogin ? "ログインする" : "もう一度試す"}
        onRetry={() => {
          clearAuthCache();
          if (needsLogin) router.replace(loginPath());
          else setAttempt((value) => value + 1);
        }}
      />
    );
  }

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
  // 予約の下書き（同伴者の選択）は swr: プレフィックスではないので個別に消す。
  // 共有端末で前ユーザーが選んだ同伴者が残らないようにするため。
  clearReservationDraft();
}
