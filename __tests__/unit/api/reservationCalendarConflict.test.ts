/**
 * 単体テスト: Google カレンダーに直接入れた予定と、ミニアプリからの予約の突き合わせ。
 *
 * 再現する不具合（2026-08-06）: GCal からトレーラーを予約したのに、ミニアプリ側では
 * その日の枠が空きに見え、そのまま予約（仮押さえ＋決済リンク発行）まで進めてしまった。
 * トレーラーの経路 `POST /api/reservations/pending` は GCal を**一度も見ていなかった**。
 *
 * 固定する仕様:
 *  - GCal に重なる予定があれば 409 ALREADY_BOOKED。**Square 決済リンクを作らない・Firestore にも書かない**
 *  - 空いていれば従来どおり仮押さえと決済リンクを作る
 *  - GCal が読めないときは 503 CALENDAR_UNAVAILABLE（通さない＝ダブルブッキングさせない）
 *  - 通常予約 `POST /api/reservations` も同じく GCal の予定で 409
 */
const mockListCalendarEvents = jest.fn();
const mockCreatePaymentLink = jest.fn();

jest.mock("@/lib/auth", () => ({
  requireMemberProfileComplete: jest.fn().mockResolvedValue("U_user"),
  requireMember: jest.fn().mockResolvedValue("U_user"),
}));
jest.mock("@/lib/facilities", () => ({ getFacilityById: jest.fn() }));
jest.mock("@/lib/googleCalendar", () => ({
  listCalendarEvents: (...args: unknown[]) => mockListCalendarEvents(...args),
  createCalendarEvent: jest.fn().mockResolvedValue("gcal-event-1"),
  deleteCalendarEvent: jest.fn(),
}));
jest.mock("@/lib/square", () => ({
  createReservationPaymentLink: (...args: unknown[]) => mockCreatePaymentLink(...args),
}));
jest.mock("@/lib/facilitySecrets", () => ({ getFacilitySquareCredentials: jest.fn().mockResolvedValue(null) }));
jest.mock("@/lib/liffUrl", () => ({ liffUrl: (p: string) => `https://liff.example${p}` }));
jest.mock("@/lib/env", () => ({ isDevLoginEnabled: () => false, isProduction: () => true }));
jest.mock("@/lib/line", () => ({ sendReservationConfirmed: jest.fn() }));
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: () => mockDb }));
jest.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, _data: data }),
  },
}));

type Data = Record<string, unknown>;
/** 書き込みが起きたかを見たいだけの最小 Firestore。ロックは常に空＝Firestore 的には空き。 */
const writes: { collection: string; id: string }[] = [];
const mockDb = {
  collection: (name: string) => ({
    doc: (id?: string) => ({
      id: id ?? `auto-${name}`,
      get: async () => ({ exists: false, data: () => undefined }),
      set: async () => { writes.push({ collection: name, id: id ?? "auto" }); },
      delete: async () => {},
    }),
    where: function () { return this; },
    get: async () => ({ docs: [], size: 0, empty: true }),
  }),
  runTransaction: async (fn: (tx: unknown) => Promise<void>) => {
    const tx = {
      get: async (ref: { get?: () => Promise<unknown> }) =>
        ref.get ? ref.get() : { docs: [], size: 0, empty: true },
      set: (ref: { id: string }, d: Data) => { writes.push({ collection: "set", id: ref.id }); void d; },
      create: (ref: { id: string }, d: Data) => { writes.push({ collection: "create", id: ref.id }); void d; },
      update: () => {},
    };
    await fn(tx);
  },
};

import { getFacilityById } from "@/lib/facilities";
import { POST as pendingPost } from "@/app/api/reservations/pending/route";
import { POST as reservationPost } from "@/app/api/reservations/route";
import type { NextRequest } from "next/server";
import dayjs from "dayjs";

// 予約日は未来（過去日チェックを避ける）。曜日は全曜日OKの施設にする。
const DATE = dayjs().add(10, "day").format("YYYY-MM-DD");

const trailer = {
  id: "fac-trailer",
  name: "トレーラー",
  calendarId: "cal-trailer",
  paymentAmount: 20000,
  availableDays: [0, 1, 2, 3, 4, 5, 6],
  openTime: "00:00",
  closeTime: "24:00",
};
const meetingRoom = { ...trailer, id: "fac-room", name: "会議室", paymentAmount: 0 };

function req(body: unknown): NextRequest {
  return {
    json: async () => body,
    headers: { get: () => "https://example.test" },
    nextUrl: { origin: "https://example.test" },
  } as unknown as NextRequest;
}

const slot = { facilityId: trailer.id, date: DATE, startTime: "13:00", endTime: "15:00" };

beforeEach(() => {
  writes.length = 0;
  mockListCalendarEvents.mockReset();
  mockCreatePaymentLink.mockReset().mockResolvedValue({ url: "https://square.test/pay", orderId: "ord-1" });
  (getFacilityById as jest.Mock).mockResolvedValue(trailer);
});

describe("トレーラー仮押さえ（POST /api/reservations/pending）", () => {
  test("★GCalに終日の予定があるとその日は予約できない（今回の不具合）", async () => {
    mockListCalendarEvents.mockResolvedValue([
      { start: { date: DATE }, end: { date: dayjs(DATE).add(1, "day").format("YYYY-MM-DD") } },
    ]);
    const res = await pendingPost(req(slot));
    expect(res.status).toBe(409);
    expect((res as unknown as { _data: { error: string } })._data.error).toBe("ALREADY_BOOKED");
    // 決済リンクも仮押さえも作らない
    expect(mockCreatePaymentLink).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  test("GCalに時刻つきの予定が重なっていても予約できない", async () => {
    mockListCalendarEvents.mockResolvedValue([
      { start: { dateTime: `${DATE}T14:00:00+09:00` }, end: { dateTime: `${DATE}T16:00:00+09:00` } },
    ]);
    expect((await pendingPost(req(slot))).status).toBe(409);
    expect(mockCreatePaymentLink).not.toHaveBeenCalled();
  });

  test("GCalが空いていれば従来どおり仮押さえ＋決済リンクを作る", async () => {
    mockListCalendarEvents.mockResolvedValue([]);
    const res = await pendingPost(req(slot));
    expect(res.status).toBe(200);
    expect((res as unknown as { _data: { paymentUrl: string } })._data.paymentUrl).toBe("https://square.test/pay");
    expect(mockCreatePaymentLink).toHaveBeenCalledTimes(1);
  });

  test("GCalが読めないときは通さない（503・決済リンクも作らない）", async () => {
    mockListCalendarEvents.mockRejectedValue(new Error("network"));
    const res = await pendingPost(req(slot));
    expect(res.status).toBe(503);
    expect((res as unknown as { _data: { error: string } })._data.error).toBe("CALENDAR_UNAVAILABLE");
    expect(mockCreatePaymentLink).not.toHaveBeenCalled();
  });
});

describe("通常予約（POST /api/reservations）", () => {
  beforeEach(() => (getFacilityById as jest.Mock).mockResolvedValue(meetingRoom));

  test("GCalの終日予定があると 409", async () => {
    mockListCalendarEvents.mockResolvedValue([
      { start: { date: DATE }, end: { date: dayjs(DATE).add(1, "day").format("YYYY-MM-DD") } },
    ]);
    const res = await reservationPost(req({ ...slot, facilityId: meetingRoom.id }));
    expect(res.status).toBe(409);
    expect((res as unknown as { _data: { error: string } })._data.error).toBe("ALREADY_BOOKED");
  });

  test("GCalが読めないときは 503", async () => {
    mockListCalendarEvents.mockRejectedValue(new Error("network"));
    const res = await reservationPost(req({ ...slot, facilityId: meetingRoom.id }));
    expect(res.status).toBe(503);
  });
});
