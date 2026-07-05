"use client";

import { useEffect, useRef } from "react";

/**
 * 定期ポーリング＋画面復帰で再取得する共通フック。
 * 可視(visible)のときだけポーリングし、非表示タブでは停止＝無駄な取得をしない。
 * 復帰(visible/focus)時は即再取得してからポーリングを再開する。
 */
export function useAutoRefresh(fn: () => void, intervalMs = 12000) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer == null) timer = setInterval(() => ref.current(), intervalMs);
    };
    const stop = () => {
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        ref.current();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop();
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs]);
}
