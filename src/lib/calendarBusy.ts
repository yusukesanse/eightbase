/**
 * Google カレンダーに**人が直接入れた予定**（アプリを通さない手動予約）を、空き状況と予約可否に取り込む。
 *
 * 背景（2026-08-06 の不具合）: 空きの真実の源を Firestore の `reservationLocks` に一本化した結果、
 * GCal から直接入れたトレーラーの予約が**ミニアプリ側で空きのまま**表示され、そのまま予約できてしまった。
 * トレーラー（`paymentAmount>0`）の経路 `POST /api/reservations/pending` は GCal を一切見ておらず、
 * 通常の `POST /api/reservations` が呼ぶ `checkAvailability` も**終日予定を素通り**させていた
 * （終日は `start.date` しか無く、旧実装は 00:00〜00:00 の長さゼロとして扱っていた）。
 *
 * この2つを塞ぐため、
 *  - GCal の予定を「その日(JST)の busy 時間帯」に正規化する純関数（終日・日跨ぎ・キャンセル・空き時間を処理）
 *  - 空き状況API用の取得関数（1リクエストで複数日ぶん）
 *  - 予約確定前のガード（`assertCalendarSlotFree`）
 * をここに集約する。**Firestore のロックと GCal の両方を見て初めて「空き」**とする。
 *
 * ⚠️ 判定の向き（意図的に非対称）
 *  - 予約する側（POST）は GCal が読めなければ **失敗させる**（`CALENDAR_UNAVAILABLE`）。
 *    読めないまま通すと、まさに今回のダブルブッキングが起きる。
 *  - 表示側（空き状況API）は GCal が読めなくても Firestore ぶんだけ返す（画面が真っ白にならない）。
 *    表示が多少甘くても、確定時に上記のガードで必ず弾かれる。
 * ⚠️ `calendarId` 未設定の施設は GCal 連携なし＝この判定をスキップする（従来どおり Firestore のみ）。
 */
import { listCalendarEvents } from "./googleCalendar";
import { intervalsOverlap } from "./reservations";
import { timeToMin } from "./date";

/** その日(JST)の占有時間帯。"HH:mm"。日の終わりまで塞ぐ場合は end="24:00"。 */
export interface BusyInterval {
  start: string;
  end: string;
}

/** GCal イベント（必要な項目だけ・googleapis の型に依存しない）。 */
export interface CalendarEventLike {
  id?: string | null;
  status?: string | null;
  /** "transparent" = 予定ありだが「空き時間」扱い（GCalの仕様どおり塞がない）。 */
  transparency?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** JST の 0:00 を epoch(ms) で。TZ に依存させないため必ず +09:00 を明示する（本番は TZ=UTC）。 */
function jstDayStartMs(date: string): number {
  return new Date(`${date}T00:00:00+09:00`).getTime();
}

/** 0:00 からの経過分 → "HH:mm"（1440 は "24:00"）。 */
function minutesToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * GCal のイベント一覧 → 指定日(JST)の busy 時間帯。
 *
 * - 終日予定（`start.date`）は **その日全体を塞ぐ**（`end.date` は排他的な翌日）。
 * - 日跨ぎ・複数日の予定はその日の範囲に切り詰める。
 * - `cancelled` と `transparency: "transparent"`（空き時間）は塞がない。
 * - `ignoreEventIds` に入れた ID は無視する（アプリが作った自分のミラーを除外する用途）。
 */
export function busyIntervalsForDate(
  events: CalendarEventLike[],
  date: string,
  opts: { ignoreEventIds?: Iterable<string> } = {}
): BusyInterval[] {
  const dayStart = jstDayStartMs(date);
  const dayEnd = dayStart + DAY_MS;
  const ignore = new Set(opts.ignoreEventIds ?? []);
  const out: BusyInterval[] = [];

  for (const e of events) {
    if (!e) continue;
    if (e.status === "cancelled") continue;
    if (e.transparency === "transparent") continue;
    if (e.id && ignore.has(e.id)) continue;

    let s: number;
    let t: number;
    if (e.start?.dateTime) {
      s = new Date(e.start.dateTime).getTime();
      t = e.end?.dateTime ? new Date(e.end.dateTime).getTime() : s;
    } else if (e.start?.date) {
      // 終日予定。end.date は「翌日」（排他的）。未設定なら1日ぶんとみなす。
      s = jstDayStartMs(e.start.date);
      t = e.end?.date ? jstDayStartMs(e.end.date) : s + DAY_MS;
    } else {
      continue;
    }
    if (!Number.isFinite(s) || !Number.isFinite(t)) continue;

    const from = Math.max(s, dayStart);
    const to = Math.min(t, dayEnd);
    if (to <= from) continue; // その日にかからない／長さゼロ

    out.push({
      start: minutesToTime(Math.round((from - dayStart) / 60000)),
      end: minutesToTime(Math.round((to - dayStart) / 60000)),
    });
  }

  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * 指定日の GCal 予定を busy 時間帯で取得する。calendarId 未設定なら [] （連携なし）。
 * 呼び出し側で失敗の扱い（表示は握りつぶす／予約は失敗させる）を決められるよう、例外はそのまま投げる。
 */
export async function getCalendarBusySlots(
  calendarId: string | null | undefined,
  date: string
): Promise<BusyInterval[]> {
  const byDate = await getCalendarBusySlotsByDate(calendarId, [date]);
  return byDate[date] ?? [];
}

/**
 * 複数日ぶんの busy 時間帯を **GCal 1リクエスト**で取得する（週表示用。7日で7回叩かない）。
 * calendarId 未設定・日付なしなら {}。
 */
export async function getCalendarBusySlotsByDate(
  calendarId: string | null | undefined,
  dates: string[]
): Promise<Record<string, BusyInterval[]>> {
  if (!calendarId || dates.length === 0) return {};
  const sorted = [...dates].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const timeMin = new Date(jstDayStartMs(first)).toISOString();
  const timeMax = new Date(jstDayStartMs(last) + DAY_MS).toISOString();

  const events = await listCalendarEvents(calendarId, timeMin, timeMax);
  const out: Record<string, BusyInterval[]> = {};
  for (const d of dates) out[d] = busyIntervalsForDate(events, d);
  return out;
}

/**
 * 予約確定の直前ガード: GCal 側に重なる予定があれば `ALREADY_BOOKED` を投げる。
 * GCal が読めなかったときは `CALENDAR_UNAVAILABLE` を投げる（**通さない**）。
 *
 * ⚠️ Firestore の transaction の**外**で呼ぶこと（ネットワーク待ちを tx に入れない）。
 *    ロックによる最終判定（`assertSlotFreeInTx`）はこの後の transaction で行う。
 */
export async function assertCalendarSlotFree(
  calendarId: string | null | undefined,
  params: { date: string; startTime: string; endTime: string; ignoreEventIds?: Iterable<string> }
): Promise<void> {
  if (!calendarId) return; // GCal 連携なしの施設（従来どおり Firestore のみで判定）
  const { date, startTime, endTime } = params;

  let busy: BusyInterval[];
  try {
    const timeMin = new Date(jstDayStartMs(date)).toISOString();
    const timeMax = new Date(jstDayStartMs(date) + DAY_MS).toISOString();
    const events = await listCalendarEvents(calendarId, timeMin, timeMax);
    busy = busyIntervalsForDate(events, date, { ignoreEventIds: params.ignoreEventIds });
  } catch (e) {
    console.error("[calendarBusy] Google Calendar の取得に失敗:", e);
    throw new Error("CALENDAR_UNAVAILABLE");
  }

  const reqStart = timeToMin(startTime);
  const reqEnd = timeToMin(endTime);
  const conflict = busy.some((b) =>
    intervalsOverlap(reqStart, reqEnd, timeToMin(b.start), timeToMin(b.end))
  );
  if (conflict) throw new Error("ALREADY_BOOKED");
}

/** 空き状況API用: GCal が読めなくても表示を止めない（Firestore ぶんだけで続行する）。 */
export async function getCalendarBusySlotsSafe(
  calendarId: string | null | undefined,
  dates: string[]
): Promise<Record<string, BusyInterval[]>> {
  try {
    return await getCalendarBusySlotsByDate(calendarId, dates);
  } catch (e) {
    console.error("[calendarBusy] 空き状況の GCal 取得に失敗（Firestore のみで続行）:", e);
    return {};
  }
}
