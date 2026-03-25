/**
 * 単体テスト: 公開施設API /api/facilities
 * calendarIdがレスポンスに含まれないことを確認（セキュリティ）
 */
import type { Facility } from "@/types";

const mockActiveFacilities: Facility[] = [
  { id: "room-a", name: "会議室A", type: "meeting_room", capacity: 6, calendarId: "secret-cal-a@google.com", active: true, order: 1 },
  { id: "booth-1", name: "ブース1", type: "booth", capacity: 1, calendarId: "secret-cal-b@google.com", active: true, order: 2 },
];

// facilities モジュールをモック
jest.mock("@/lib/facilities", () => ({
  getFacilities: jest.fn().mockResolvedValue(mockActiveFacilities),
}));

// NextResponse モック
const mockJson = jest.fn().mockImplementation((data, init?) => ({
  status: init?.status ?? 200,
  json: async () => data,
  _data: data,
}));
jest.mock("next/server", () => ({
  NextResponse: { json: (...args: unknown[]) => mockJson(...args) },
}));

import { GET } from "@/app/api/facilities/route";

describe("公開施設API — GET /api/facilities", () => {
  beforeEach(() => {
    mockJson.mockClear();
  });

  test("正常にレスポンスが返る", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
  });

  test("レスポンスにfacilities配列が含まれる", async () => {
    const res = await GET();
    const data = res._data;
    expect(data.facilities).toBeDefined();
    expect(Array.isArray(data.facilities)).toBe(true);
    expect(data.facilities.length).toBe(2);
  });

  test("calendarIdがレスポンスに含まれない（セキュリティ）", async () => {
    const res = await GET();
    const data = res._data;
    for (const facility of data.facilities) {
      expect(facility.calendarId).toBeUndefined();
      expect(facility).not.toHaveProperty("calendarId");
    }
  });

  test("施設名・タイプ・定員は含まれる", async () => {
    const res = await GET();
    const data = res._data;
    const roomA = data.facilities.find((f: Facility) => f.id === "room-a");
    expect(roomA).toBeDefined();
    expect(roomA.name).toBe("会議室A");
    expect(roomA.type).toBe("meeting_room");
    expect(roomA.capacity).toBe(6);
  });

  test("エラー時は500を返す", async () => {
    const { getFacilities } = require("@/lib/facilities");
    getFacilities.mockRejectedValueOnce(new Error("DB error"));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
