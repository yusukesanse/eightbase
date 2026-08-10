/**
 * ゲーム参加タブのカレンダーで「どこまで過去へ遡れるか」を決める純関数（4種目共通）。
 *
 * 参加タブは過去の開催日を選ぶとその日の成績（当日順位）を出せるが、
 * MonthCalendar は既定で当月より前へ戻れない＝**当月内の過去日しか辿れなかった**。
 * ここで求めた月を MonthCalendar の `minMonth` に渡して、過去の開催日まで戻れるようにする。
 *
 * 下限は「クライアントが持っている開催日データの最も古い月」にする:
 * - 開催日集合（{game}Schedule）はアクティブシーズン分しか返らないので、実質シーズンの範囲で止まる。
 * - それより前へ戻せても全日グレーで選べず、当日成績APIもアクティブシーズン基準なので意味がない。
 *
 * ⚠️ 種目ごとにコピーしないこと（4種目で同じ判定を散らすと片方だけ直る事故になる）。
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" → "YYYY-MM"。形式が違う値は無視する（undefined）。 */
function toMonth(date: string | null | undefined): string | undefined {
  if (!date || !DATE_RE.test(date)) return undefined;
  return date.slice(0, 7);
}

/**
 * 渡した日付のうち最も古い月（"YYYY-MM"）。1件も無ければ undefined（＝過去へ戻せない＝従来どおり）。
 * 引数は日付集合（Set/配列）でも単一の日付文字列（シーズン開始日など）でもよい。
 */
export function calendarMinMonth(
  ...sources: (Iterable<string> | string | null | undefined)[]
): string | undefined {
  let min: string | undefined;
  for (const src of sources) {
    if (!src) continue;
    for (const d of typeof src === "string" ? [src] : src) {
      const m = toMonth(d);
      if (m && (min === undefined || m < min)) min = m;
    }
  }
  return min;
}

/**
 * 実際に過去の月へ戻れるか（下限月が今月より前）。カレンダー下の案内文の出し分けに使う。
 * 下限が今月と同じ（＝今シーズンの開催日が今月しか無い）なら「‹」は押せないので案内も出さない。
 * @param today 今日（JST）"YYYY-MM-DD"
 */
export function canBrowsePastMonths(minMonth: string | undefined, today: string): boolean {
  return !!minMonth && minMonth < today.slice(0, 7);
}
