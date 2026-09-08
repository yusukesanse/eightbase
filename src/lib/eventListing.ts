/**
 * イベント一覧の「今後 / 過去 / すべて」の絞り込みと並び順（純関数・クライアント/サーバー両用）。
 *
 * /events（LINE の「イベントを見る」の飛び先）と /info のイベントタブで共用する。
 * 以前は /events が API の昇順（古い順）をそのまま先頭＝Featured にしていたため、
 * 過去のイベントが最上段に出ていた（2026-09-07 報告）。判定・並びをここに1本化する。
 *
 * - 「今日」は JST の YYYY-MM-DD を呼び出し側が渡す（`todayJst()`）。本番サーバーは TZ=UTC
 *   なので、startAt の暦日も `jstDateFromIso()` で JST に直して比べる。
 * - upcoming: 今日以降（今日開催は開始時刻を過ぎていても含む）を古い順＝直近が先頭。
 * - past: 今日より前を新しい順。
 * - all: 全件を新しい順。
 * - startAt が不正な要素は upcoming / past から除き、all では末尾に置く（例外は投げない）。
 */
import { jstDateFromIso } from "./date";

export type EventTimeFilter = "upcoming" | "past" | "all";

export function filterAndSortEvents<T extends { startAt: string }>(
  events: readonly T[],
  filter: EventTimeFilter,
  today: string
): T[] {
  const withTime = events.map((ev) => {
    const t = Date.parse(ev.startAt);
    const valid = Number.isFinite(t);
    return { ev, t: valid ? t : Number.NaN, day: valid ? jstDateFromIso(ev.startAt) : "" };
  });

  let picked = withTime;
  if (filter === "upcoming") {
    picked = withTime.filter((x) => x.day !== "" && x.day >= today);
  } else if (filter === "past") {
    picked = withTime.filter((x) => x.day !== "" && x.day < today);
  }

  const asc = filter === "upcoming";
  const sorted = [...picked].sort((a, b) => {
    const aBad = Number.isNaN(a.t);
    const bBad = Number.isNaN(b.t);
    if (aBad && bBad) return 0;
    if (aBad) return 1; // 不正な日付は末尾
    if (bBad) return -1;
    return asc ? a.t - b.t : b.t - a.t;
  });

  return sorted.map((x) => x.ev);
}
