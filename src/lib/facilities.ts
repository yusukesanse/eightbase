import type { Facility } from "@/types";

// 施設マスタ
// calendarId は実際の Google Workspace カレンダー Email アドレスに変更すること
export const FACILITIES: Facility[] = [
  {
    id: "meetingroom-a",
    name: "会議室 A",
    type: "meeting_room",
    capacity: 6,
    calendarId: process.env.CALENDAR_ID_MEETINGROOM_A ?? "meetingroom-a@example.com",
  },
  {
    id: "meetingroom-b",
    name: "会議室 B",
    type: "meeting_room",
    capacity: 4,
    calendarId: process.env.CALENDAR_ID_MEETINGROOM_B ?? "meetingroom-b@example.com",
  },
  {
    id: "meetingroom-c",
    name: "会議室 C",
    type: "meeting_room",
    capacity: 8,
    calendarId: process.env.CALENDAR_ID_MEETINGROOM_C ?? "meetingroom-c@example.com",
  },
  {
    id: "booth-1",
    name: "ブース 1",
    type: "booth",
    capacity: 1,
    calendarId: process.env.CALENDAR_ID_BOOTH_1 ?? "booth-1@example.com",
  },
  {
    id: "booth-2",
    name: "ブース 2",
    type: "booth",
    capacity: 1,
    calendarId: process.env.CALENDAR_ID_BOOTH_2 ?? "booth-2@example.com",
  },
  {
    id: "booth-3",
    name: "ブース 3",
    type: "booth",
    capacity: 1,
    calendarId: process.env.CALENDAR_ID_BOOTH_3 ?? "booth-3@example.com",
  },
];

export function getFacilityById(id: string): Facility | undefined {
  return FACILITIES.find((f) => f.id === id);
}
