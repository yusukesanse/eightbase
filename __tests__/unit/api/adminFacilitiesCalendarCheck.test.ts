jest.mock("@/lib/adminAuth", () => ({ checkAdminAuth: jest.fn() }));
jest.mock("@/lib/facilities", () => ({ getFacilityById: jest.fn() }));
jest.mock("@/lib/calendarBusy", () => ({ readCalendarDay: jest.fn(), summarizeEventsForDate: jest.fn(), busyIntervalsForDate: jest.fn() }));
import { NextRequest } from "next/server";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getFacilityById } from "@/lib/facilities";
import { readCalendarDay, summarizeEventsForDate, busyIntervalsForDate } from "@/lib/calendarBusy";
import { POST } from "@/app/api/admin/facilities/calendar-check/route";
const date = "2026-09-28";
const request = (body: unknown = { facilityId: "room", date }) => new NextRequest("http://localhost/api/admin/facilities/calendar-check", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
  jest.resetAllMocks();
  (checkAdminAuth as jest.Mock).mockResolvedValue("admin");
  (getFacilityById as jest.Mock).mockResolvedValue({ id: "room", calendarId: "private-calendar-id" });
});
test("readable calendar returns summaries and busy intervals without private fields", async () => {
  const events = [{ summary: "private-event-title" }, { transparency: "transparent" }];
  const summary = [{ start: "10:00", end: "11:00", busy: true }, { start: "12:00", end: "13:00", busy: false }];
  const busy = [{ start: "10:00", end: "11:00" }];
  (readCalendarDay as jest.Mock).mockResolvedValue({ ok: true, events });
  (summarizeEventsForDate as jest.Mock).mockReturnValue(summary);
  (busyIntervalsForDate as jest.Mock).mockReturnValue(busy);
  const res = await POST(request()); const data = await res.json();
  expect(res.status).toBe(200);
  expect(data).toEqual({ ok: true, events: summary, busyIntervals: busy });
  expect(readCalendarDay).toHaveBeenCalledWith("private-calendar-id", date);
  expect(summarizeEventsForDate).toHaveBeenCalledWith(events, date);
  expect(busyIntervalsForDate).toHaveBeenCalledWith(events, date);
  expect(JSON.stringify(data)).not.toMatch(/private-calendar-id|private-event-title/);
});
test("unconfigured calendar skips Google", async () => {
  (getFacilityById as jest.Mock).mockResolvedValue({ id: "room", calendarId: "" });
  const res = await POST(request());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: false, errorKind: "not_configured", events: [], busyIntervals: [] });
  expect(readCalendarDay).not.toHaveBeenCalled();
});
test.each(["not_found", "forbidden", "other"])("unreadable %s returns a normal result", async (errorKind) => {
  (readCalendarDay as jest.Mock).mockResolvedValue({ ok: false, errorKind });
  const res = await POST(request());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: false, errorKind, events: [], busyIntervals: [] });
});
test("unauthenticated returns 401", async () => {
  (checkAdminAuth as jest.Mock).mockResolvedValue(null);
  const res = await POST(request());
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: "認証が必要です" });
  expect(getFacilityById).not.toHaveBeenCalled();
});
test.each([{}, { facilityId: "room" }, { date }, { facilityId: "room", date: "28/09/2026" }, { facilityId: "room", date: "2026-02-30" }, null])("invalid body %j returns 400", async (body) => {
  expect((await POST(request(body))).status).toBe(400);
  expect(readCalendarDay).not.toHaveBeenCalled();
});
test("missing facility returns 404", async () => {
  (getFacilityById as jest.Mock).mockResolvedValue(null);
  const res = await POST(request());
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "施設が見つかりません" });
});
