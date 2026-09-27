jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn(() => ({})) }));
jest.mock("@/lib/auth", () => ({ requireMember: jest.fn(async () => "member") }));
jest.mock("@/lib/facilities", () => ({ getFacilityById: jest.fn(async () => ({ id: "room", name: "会議室", calendarId: "cal", availableDays: [1, 2, 3, 4, 5] })) }));
jest.mock("@/lib/googleCalendar", () => ({ listCalendarEvents: jest.fn() }));
jest.mock("@/lib/calendarAlert", () => ({ notifyCalendarUnreadable: jest.fn() }));
jest.mock("@/lib/reservations", () => ({
  getBlockingLockedSlots: jest.fn(async () => [{ start: "10:00", end: "11:00" }]),
  validateReservationSlot: jest.fn(() => ({ ok: true })),
  intervalsOverlap: (a: number, b: number, c: number, d: number) => a < d && c < b,
}));
import { NextRequest } from "next/server";
import { listCalendarEvents } from "@/lib/googleCalendar";
import { notifyCalendarUnreadable } from "@/lib/calendarAlert";
import { GET as daily } from "@/app/api/reservations/availability/route";
import { GET as weekly } from "@/app/api/reservations/week-availability/route";
const cases = [
  { name: "daily slots", handler: daily, query: "date=2026-09-28" },
  { name: "daily blocked", handler: daily, query: "date=2026-09-28&startTime=10:00&endTime=11:00" },
  { name: "daily free", handler: daily, query: "date=2026-09-28&startTime=12:00&endTime=13:00" },
  { name: "weekly", handler: weekly, query: "weekStart=2026-09-28" },
];
beforeEach(() => { jest.clearAllMocks(); (notifyCalendarUnreadable as jest.Mock).mockReset().mockResolvedValue(undefined); });
describe.each(cases)("$name notifications", ({ handler, query }) => {
  const run = () => handler(new NextRequest(`http://localhost?facilityId=room&${query}`));
  test("read failure notifies once; notification failure preserves availability", async () => {
    (listCalendarEvents as jest.Mock).mockResolvedValue([]);
    const baseline = await (await run()).json();
    (listCalendarEvents as jest.Mock).mockRejectedValue(new Error("unreadable"));
    const first = await run();
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual(baseline);
    expect(notifyCalendarUnreadable).toHaveBeenCalledTimes(1);
    expect(notifyCalendarUnreadable).toHaveBeenCalledWith("room", "会議室");
    (notifyCalendarUnreadable as jest.Mock).mockRejectedValue(new Error("notify failed"));
    const second = await run();
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(baseline);
    expect(notifyCalendarUnreadable).toHaveBeenCalledTimes(2);
    expect(listCalendarEvents).toHaveBeenCalledTimes(3);
  });
  test("read success never notifies", async () => {
    (listCalendarEvents as jest.Mock).mockResolvedValue([]);
    expect((await run()).status).toBe(200);
    expect(notifyCalendarUnreadable).not.toHaveBeenCalled();
    expect(listCalendarEvents).toHaveBeenCalledTimes(1);
  });
});


test("transparent の予定と重なる時間帯は available:false・bookedSlots に含まれる", async () => {
  (listCalendarEvents as jest.Mock).mockResolvedValue([
    { transparency: "transparent", start: { dateTime: "2026-09-28T12:00:00+09:00" }, end: { dateTime: "2026-09-28T13:00:00+09:00" } },
  ]);
  // Firestore のロック（10〜11時）とは重ならず、GCal の予定だけで塞がる。
  const res = await daily(new NextRequest("http://localhost?facilityId=room&date=2026-09-28&startTime=12:00&endTime=13:00"));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    available: false,
    reason: "ALREADY_BOOKED",
    bookedSlots: [{ start: "10:00", end: "11:00" }, { start: "12:00", end: "13:00" }],
  });
  expect(notifyCalendarUnreadable).not.toHaveBeenCalled();
});
