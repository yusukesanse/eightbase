"use client";

import { TimelineBoard } from "@/components/TimelineBoard";

/**
 * /timeline 掲示板ページ（ディープリンク維持）。本体は TimelineBoard に集約し、
 * Info の「掲示板」タブ（E-1）でも同じコンポーネントを埋め込みで再利用する。
 */
export default function TimelinePage() {
  return <TimelineBoard />;
}
