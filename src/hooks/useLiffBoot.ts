"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { runLiffServerLogin, type LiffLoginResult } from "@/lib/liff";
import { clearAuthCache } from "@/components/AuthGuard";
import { loginDestination } from "@/lib/loginDestination";

/**
 * `/` と `/login` で共通の LIFF→サーバーセッション発行ブートフロー。
 *
 * 両画面に共通の処理だけをここに集約する:
 *  - "linked": セッションが切り替わったので表示キャッシュを破棄し、
 *    ゲストは /games、会員・社員はプロフィールの完了状態に応じて遷移する。
 *  - 例外: ログとともに null を返す（呼び出し側でエラー画面を出す）。
 *
 * "redirecting" / "needs-linking" / "needs-line-login" / "no-access" は
 * 画面ごとに表示が異なるため、結果をそのまま呼び出し側へ返して分岐を委ねる。
 *
 * @returns boot() … ブートを実行し、画面側で扱うべき結果を返す（linked は遷移済み / 例外は null）。
 */
export function useLiffBoot(): () => Promise<LiffLoginResult | null> {
  const router = useRouter();
  const active = useRef(false);
  const inFlight = useRef<Promise<LiffLoginResult | null> | null>(null);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  return useCallback((): Promise<LiffLoginResult | null> => {
    if (inFlight.current) return inFlight.current;
    inFlight.current = (async () => {
      try {
        const result = await runLiffServerLogin();
        if (active.current && result.kind === "linked") {
          clearAuthCache();
          router.replace(loginDestination(result.role, result.profileComplete, window.location.search));
        }
        return result;
      } catch (err) {
        console.error("[useLiffBoot] boot error:", err);
        return null;
      } finally {
        inFlight.current = null;
      }
    })();
    return inFlight.current;
  }, [router]);
}
