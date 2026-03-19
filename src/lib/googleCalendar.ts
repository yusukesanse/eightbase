import { google } from "googleapis";
import dayjs from "dayjs";

// ─── 認証クライアント ──────────────────────────────────────────────────────────
function getAuthClient() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
}

function getCalendar() {
  return google.calendar({ version: "v3", auth: getAuthClient() });
}

// ─── 空きスロット取得 ─────────────────────────────────────────────────────────
/**
 * 指定日の予約済み時間帯を取得する。
 * @returns { start: string; end: string }[] の配列（HH:MM 形式）
 */
export async function getBookedSlots(
  calendarId: string,
  date: string // YYYY-MM-DD
): Promise<{ start: string; end: string }[]> {
  const calendar = getCalendar();

  const timeMin = dayjs(`${date}T00:00:00`).toISOString();
  const timeMax = dayjs(`${date}T23:59:59`).toISOString();

  const res = await calendar.events.list({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
  });

  const events = res.data.items ?? [];

  return events
    .filter((e: { status?: string | null }) => e.status !== "cancelled")
    .map((e: { start?: { dateTime?: string | null; date?: string | null } | null; end?: { dateTime?: string | null; date?: string | null } | null }) => ({
      start: dayjs(e.start?.dateTime ?? e.start?.date).format("HH:mm"),
      end:   dayjs(e.end?.dateTime   ?? e.end?.date  ).format("HH:mm"),
    }));
}

// ─── 空き確認 ─────────────────────────────────────────────────────────────────
/**
 * 指定時間帯に空きがあるか確認する。
 */
export async function checkAvailability(
  calendarId: string,
  date: string,
  startTime: string, // HH:MM
  endTime: string    // HH:MM
): Promise<boolean> {
  const booked = await getBookedSlots(calendarId, date);

  const reqStart = timeToMinutes(startTime);
  const reqEnd   = timeToMinutes(endTime);

  for (const slot of booked) {
    const sStart = timeToMinutes(slot.start);
    const sEnd   = timeToMinutes(slot.end);
    // 重複チェック: 両端を含まない（隣接は OK）
    if (reqStart < sEnd && reqEnd > sStart) return false;
  }

  return true;
}

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

  const startDateTime = dayjs(`${date}T${startTime}:00`).toISOString();
  const endDateTime   = dayjs(`${date}T${endTime}:00`).toISOString();

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

// ─── 予約削除 ─────────────────────────────────────────────────────────────────
export async function deleteCalendarEvent(
  calendarId: string,
  eventId: string
): Promise<void> {
  const calendar = getCalendar();
  await calendar.events.delete({ calendarId, eventId });
}

// ─── ユーティリティ ───────────────────────────────────────────────────────────
function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
