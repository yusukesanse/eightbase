"use client";

import { useEffect, useRef } from "react";

/**
 * 定期ポーリング＋画面復帰（focus / visibilitychange）で再取得する共通フック。
 * 抜け番の進行など「他ユーザーの操作で変わる状態」を軽く追従させる。
 */
export function useAutoRefresh(fn: () => void, intervalMs = 12000) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const id = setInterval(() => ref.current(), intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") ref.current();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs]);
}
