"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

/** ログイン不要のパス（/ は LIFF エンドポイントURL で初期化に必要） */
const PUBLIC_PATHS = ["/login", "/"];
/** ログイン不要のプレフィックス（/admin は独自の認証を持つ） */
const PUBLIC_PREFIXES = ["/admin"];

/**
 * 認証ガード。
 * - セッション Cookie を /api/auth/check に送り認証状態を確認する
 *   （旧: x-line-user-id ヘッダーを廃止 → httpOnly Cookie ベースに変更）
 * - 未認証の場合 /login にリダイレクト
 * - /login などのパブリックパスはチェックをスキップ
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "authorized" | "unauthorized">("loading");

  const isPublicPath =
    PUBLIC_PATHS.includes(pathname) ||
    PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  useEffect(() => {
    if (isPublicPath) {
      setStatus("authorized");
      return;
    }

    let cancelled = false;

    // Cookie は自動送信されるため、ヘッダー追加不要
    fetch("/api/auth/check", { credentials: "include" })
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          if (data.authorized) {
            setStatus("authorized");
          } else {
            setStatus("unauthorized");
            router.replace("/login");
          }
        } else {
          setStatus("unauthorized");
          router.replace("/login");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("unauthorized");
          router.replace("/login");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isPublicPath, router]);

  // ロード中
  if (status === "loading" && !isPublicPath) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-[#06C755] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-400">読み込み中...</p>
        </div>
      </div>
    );
  }

  // リダイレクト中は何も表示しない
  if (status === "unauthorized") return null;

  return <>{children}</>;
}
