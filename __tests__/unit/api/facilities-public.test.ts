/**
 * 単体テスト: 公開施設API /api/facilities
 * calendarId / switchBotDeviceId がレスポンスに含まれないことを確認（セキュリティ）
 */
import type { Facility } from "@/types";

/** NextResponse モックの戻り値型（_data はモックが付与する） */
type MockRes = { status: number; _data: Record<string, any>; json: () => Promise<unknown> };

const mockActiveFacilities: Facility[] = [
  { id: "room-a", name: "会議室A", type: "meeting_room", capacity: 6, calendarId: "secret-cal-a@google.com", active: true, order: 1 },
  { id: "booth-1", name: "ブース1", type: "booth", capacity: 1, calendarId: "secret-cal-b@google.com", active: true, order: 2, paymentAmount: 22000, switchBotDeviceId: "SECRET-DEVICE-ID" },
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
import type { NextRequest } from "next/server";

const asMock = (res: unknown): MockRes => res as MockRes;

// プレビューCookie無しの最小モックリクエスト（isPreviewMode → false で通常経路へ）
const req = { cookies: { get: () => undefined } } as unknown as NextRequest;

describe("公開施設API — GET /api/facilities", () => {
  beforeEach(() => {
    mockJson.mockClear();
  });

  test("正常にレスポンスが返る", async () => {
    const res = asMock(await GET(req));
    expect(res.status).toBe(200);
  });

  test("レスポンスにfacilities配列が含まれる", async () => {
    const res = asMock(await GET(req));
    const data = res._data;
    expect(data.facilities).toBeDefined();
    expect(Array.isArray(data.facilities)).toBe(true);
    expect(data.facilities.length).toBe(2);
  });

  test("calendarIdがレスポンスに含まれない（セキュリティ）", async () => {
    const res = asMock(await GET(req));
    const data = res._data;
    for (const facility of data.facilities) {
      expect(facility.calendarId).toBeUndefined();
      expect(facility).not.toHaveProperty("calendarId");
    }
  });

  test("switchBotDeviceIdがレスポンスに含まれない（セキュリティ）", async () => {
    const res = asMock(await GET(req));
    const data = res._data;
    for (const facility of data.facilities) {
      expect(facility).not.toHaveProperty("switchBotDeviceId");
    }
    expect(JSON.stringify(data)).not.toContain("SECRET-DEVICE-ID");
  });

  test("施設名・タイプ・定員・決済額は含まれる", async () => {
    const res = asMock(await GET(req));
    const data = res._data;
    const roomA = data.facilities.find((f: Facility) => f.id === "room-a");
    expect(roomA).toBeDefined();
    expect(roomA.name).toBe("会議室A");
    expect(roomA.type).toBe("meeting_room");
    expect(roomA.capacity).toBe(6);
    // 決済額はポータルの「決済する」表示に必要なので残す
    const booth1 = data.facilities.find((f: Facility) => f.id === "booth-1");
    expect(booth1.paymentAmount).toBe(22000);
  });

  test("エラー時は500を返す", async () => {
    const { getFacilities } = require("@/lib/facilities");
    getFacilities.mockRejectedValueOnce(new Error("DB error"));
    const res = asMock(await GET(req));
    expect(res.status).toBe(500);
  });
});
