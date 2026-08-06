import { google } from "googleapis";
import dayjs from "dayjs";
import utcPlugin from "dayjs/plugin/utc";
dayjs.extend(utcPlugin);

// ─── 認証クライアント（シングルトン） ────────────────────────────────────────
// サーバーレス環境でも同じコールドスタート内なら再利用される
let _calendar: ReturnType<typeof google.calendar> | null = null;

function getCalendar(): ReturnType<typeof google.calendar> {
  if (_calendar) return _calendar;

  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });

  _calendar = google.calendar({ version: "v3", auth });
  return _calendar;
}

// ─── イベント取得（低レベル） ─────────────────────────────────────────────────
/**
 * 指定期間のイベントを取得する（繰り返しは展開済み）。
 * 期間の解釈・終日予定の扱いは `src/lib/calendarBusy.ts` 側に集約するため、ここでは生のまま返す。
 */
export async function listCalendarEvents(
  calendarId: string,
  timeMin: string, // ISO8601
  timeMax: string // ISO8601
): Promise<
  {
    id?: string | null;
    status?: string | null;
    transparency?: string | null;
    start?: { dateTime?: string | null; date?: string | null } | null;
    end?: { dateTime?: string | null; date?: string | null } | null;
  }[]
> {
  const calendar = getCalendar();
  const res = await calendar.events.list({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
  });
  return res.data.items ?? [];
}

// ─── 空きスロット取得・空き確認 ───────────────────────────────────────────────
// ⚠️ 旧 `getBookedSlots` / `checkAvailability` は削除した（2026-08-06）。
//    終日予定（`start.date` のみ）を 00:00〜00:00 の長さゼロとして扱っており、
//    GCal から入れた終日の予約を素通りさせていた。判定は `src/lib/calendarBusy.ts` に一本化する
//    （終日・日跨ぎ・transparent の扱いを純関数にまとめ、回帰テストで固定）。

// ─── 予約作成 ─────────────────────────────────────────────────────────────────
/**
 * Google Calendar にイベントを作成して eventId を返す。
 */
export async function createCalendarEvent(
  calendarId: string,
  {
    date,
    startTime,
    endTime,
    summary,
    description,
  }: {
    date: string;
    startTime: string;
    endTime: string;
    summary: string;
    description?: string;
  }
): Promise<string> {
  const calendar = getCalendar();

  // +09:00 を付与して JST として Google Calendar に登録する
  const startDateTime = `${date}T${startTime}:00+09:00`;
  const endDateTime   = `${date}T${endTime}:00+09:00`;

  const res = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary,
      description,
      start: { dateTime: startDateTime, timeZone: "Asia/Tokyo" },
      end:   { dateTime: endDateTime,   timeZone: "Asia/Tokyo" },
    },
  });

  if (!res.data.id) throw new Error("Failed to create calendar event");
  return res.data.id;
}

// ─── 予約更新 ─────────────────────────────────────────────────────────────────
/**
 * 既存の Google Calendar イベントの日時（と任意で summary/description）を更新する。
 * 管理画面の予約日時変更で、GCal をアプリ(Firestore)の新しい時間帯へ追随させるために使う。
 * 作成と同じく +09:00 / Asia/Tokyo で JST として書き込む。
 */
export async function updateCalendarEvent(
  calendarId: string,
  eventId: string,
  {
    date,
    startTime,
    endTime,
    summary,
    description,
  }: {
    date: string;
    startTime: string;
    endTime: string;
    summary?: string;
    description?: string;
  }
): Promise<void> {
  const calendar = getCalendar();

  const startDateTime = `${date}T${startTime}:00+09:00`;
  const endDateTime = `${date}T${endTime}:00+09:00`;

  await calendar.events.patch({
    calendarId,
    eventId,
    requestBody: {
      ...(summary !== undefined ? { summary } : {}),
      ...(description !== undefined ? { description } : {}),
      start: { dateTime: startDateTime, timeZone: "Asia/Tokyo" },
      end: { dateTime: endDateTime, timeZone: "Asia/Tokyo" },
    },
  });
}

// ─── 予約削除 ─────────────────────────────────────────────────────────────────
export async function deleteCalendarEvent(
  calendarId: string,
  eventId: string
): Promise<void> {
  const calendar = getCalendar();
  await calendar.events.delete({ calendarId, eventId });
}

// ─── ISO8601 日時でイベント作成（ゲーム等に使用）────────────────────────────────

export async function createCalendarEventISO(
  calendarId: string,
  {
    summary,
    description,
    startTime,
    endTime,
    location,
  }: {
    summary: string;
    description?: string;
    startTime: string;   // ISO8601
    endTime: string;     // ISO8601
    location?: string;
  }
): Promise<string> {
  const calendar = getCalendar();
  const res = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary,
      description,
      location,
      start: { dateTime: startTime, timeZone: "Asia/Tokyo" },
      end:   { dateTime: endTime,   timeZone: "Asia/Tokyo" },
    },
  });
  if (!res.data.id) throw new Error("Failed to create calendar event");
  return res.data.id;
}

// ─── ユーティリティ ───────────────────────────────────────────────────────────
function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
