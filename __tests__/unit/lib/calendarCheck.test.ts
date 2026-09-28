const mockReadCalendarDay = jest.fn();
jest.mock("@/lib/calendarBusy", () => ({ readCalendarDay: (...args: unknown[]) => mockReadCalendarDay(...args) }));

import { calendarWarningAfterSave } from "@/lib/calendarCheck";
import { CALENDAR_CHECK_ERRORS } from "@/lib/calendarCheckMessages";

beforeEach(() => { mockReadCalendarDay.mockReset(); });

test.each(["not_found", "forbidden", "other"] as const)("%s returns its message and kind", async (kind) => {
  mockReadCalendarDay.mockResolvedValue({ ok: false, errorKind: kind });
  expect(await calendarWarningAfterSave("calendar")).toEqual({ kind, message: CALENDAR_CHECK_ERRORS[kind] });
});

test("unexpected rejection returns other", async () => {
  mockReadCalendarDay.mockRejectedValue(new Error("unexpected"));
  expect(await calendarWarningAfterSave("calendar")).toEqual({ kind: "other", message: CALENDAR_CHECK_ERRORS.other });
});

test("unresolved read returns timeout after 10ms", async () => {
  mockReadCalendarDay.mockImplementation(() => new Promise(() => {}));
  expect(await calendarWarningAfterSave("calendar", 10)).toEqual({ kind: "timeout", message: CALENDAR_CHECK_ERRORS.timeout });
});

test("all four warning messages are distinct", () => {
  expect(new Set([
    CALENDAR_CHECK_ERRORS.not_found, CALENDAR_CHECK_ERRORS.forbidden,
    CALENDAR_CHECK_ERRORS.other, CALENDAR_CHECK_ERRORS.timeout,
  ]).size).toBe(4);
});

test.each(["", undefined, null, 123, false, {}])("invalid calendarId %p skips reading", async (calendarId) => {
  expect(await calendarWarningAfterSave(calendarId)).toBeUndefined();
  expect(mockReadCalendarDay).not.toHaveBeenCalled();
});

test("readable calendar has no warning", async () => {
  mockReadCalendarDay.mockResolvedValue({ ok: true, events: [] });
  expect(await calendarWarningAfterSave("calendar")).toBeUndefined();
});
