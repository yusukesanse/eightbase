/**
 * 単体テスト: src/lib/googleCalendar.ts updateCalendarEvent
 * 日時を +09:00 / Asia/Tokyo（JST）で patch することを検証（本番 TZ=UTC でもズレない）。
 */
const mockPatch = jest.fn().mockResolvedValue({ data: {} });
jest.mock("googleapis", () => ({
  google: {
    auth: { JWT: class {} },
    calendar: () => ({ events: { patch: mockPatch } }),
  },
}));

import { updateCalendarEvent } from "@/lib/googleCalendar";

beforeEach(() => mockPatch.mockClear());

test("開始・終了を +09:00 / Asia/Tokyo で patch する", async () => {
  await updateCalendarEvent("cal-a", "ev1", { date: "2026-07-11", startTime: "13:00", endTime: "15:00" });
  expect(mockPatch).toHaveBeenCalledTimes(1);
  expect(mockPatch).toHaveBeenCalledWith(
    expect.objectContaining({
      calendarId: "cal-a",
      eventId: "ev1",
      requestBody: expect.objectContaining({
        start: { dateTime: "2026-07-11T13:00:00+09:00", timeZone: "Asia/Tokyo" },
        end: { dateTime: "2026-07-11T15:00:00+09:00", timeZone: "Asia/Tokyo" },
      }),
    })
  );
});

test("summary/description は指定した時のみ送る", async () => {
  await updateCalendarEvent("cal-a", "ev1", { date: "2026-07-11", startTime: "13:00", endTime: "14:00" });
  const body = mockPatch.mock.calls[0][0].requestBody;
  expect("summary" in body).toBe(false);
  expect("description" in body).toBe(false);
});
