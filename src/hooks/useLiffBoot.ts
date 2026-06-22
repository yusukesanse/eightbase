"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { runLiffServerLogin, type LiffLoginResult } from "@/lib/liff";
import { clearAuthCache } from "@/components/AuthGuard";

/**
 * `/` と `/login` で共通の LIFF→サーバーセッション発行ブートフロー。
 *
 * 両画面に共通の処理だけをここに集約する:
 *  - "linked": セッションが切り替わったので表示キャッシュを破棄し、
 *    profileComplete に応じて /reservation か /setup-profile へ遷移する。
 *  - 例外: ログとともに null を返す（呼び出し側でエラー画面を出す）。
 *
 * "redirecting" / "needs-linking" / "needs-line-login" / "no-access" は
 * 画面ごとに表示が異なるため、結果をそのまま呼び出し側へ返して分岐を委ねる。
 *
 * @returns boot() … ブートを実行し、画面側で扱うべき結果を返す（linked は遷移済み / 例外は null）。
 */
export function useLiffBoot(): () => Promise<LiffLoginResult | null> {
  const router = useRouter();

  return useCallback(async (): Promise<LiffLoginResult | null> => {
    try {
      const result = await runLiffServerLogin();
      if (result.kind === "linked") {
        // セッション切替後は表示キャッシュを破棄。未完了なら /setup-profile 直行で往復を防ぐ。
        clearAuthCache();
        router.replace(result.profileComplete ? "/reservation" : "/setup-profile");
      }
      return result;
    } catch (err) {
      console.error("[useLiffBoot] boot error:", err);
      return null;
    }
  }, [router]);
}
