import { NextRequest } from "next/server";
const store = new Map<string, Record<string, unknown>>();
function docRef(col: string, id: string) {
  const key = `${col}/${id}`;
  return {
    key, id,
    get: async () => ({ exists: store.has(key), id, data: () => store.get(key) }),
    create: async (data: Record<string, unknown>) => { store.set(key, data); },
    delete: async () => { store.delete(key); },
  };
}
function query(col: string, conditions: [string, string, unknown][] = []) {
  return {
    doc: (id: string) => docRef(col, id),
    where: (field: string, op: string, value: unknown) => query(col, [...conditions, [field, op, value]]),
    get: async () => {
      const docs = [...store.entries()].filter(([key, data]) => key.startsWith(`${col}/`) && conditions.every(([f, op, v]) => op === "in" ? (v as unknown[]).includes(data[f]) : data[f] === v))
        .map(([key, data]) => ({ id: key.split("/")[1], data: () => data }));
      return { docs, empty: !docs.length };
    },
  };
}
const mockWrites = {
  set: (ref: ReturnType<typeof docRef>, data: Record<string, unknown>) => { store.set(ref.key, { ...store.get(ref.key), ...data }); },
  update: (ref: ReturnType<typeof docRef>, data: Record<string, unknown>) => { store.set(ref.key, { ...store.get(ref.key), ...data }); },
  delete: (ref: ReturnType<typeof docRef>) => { store.delete(ref.key); },
  commit: async () => {},
};
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: () => ({
  collection: query,
  batch: () => mockWrites,
  runTransaction: async (fn: (tx: unknown) => Promise<void>) => fn(mockWrites),
}) }));
jest.mock("@/lib/square", () => ({ ...jest.requireActual("@/lib/square"), refundSquarePayment: jest.fn() }));
jest.mock("@/lib/auth", () => ({ requireMember: async () => "U1" }));
jest.mock("@/lib/adminAuth", () => ({ checkAdminAuth: async () => true }));
jest.mock("@/lib/facilities", () => ({ getFacilityById: async () => ({ calendarId: "cal" }) }));
jest.mock("@/lib/googleCalendar", () => ({ deleteCalendarEvent: jest.fn() }));
jest.mock("@/lib/line", () => ({ sendReservationCancelled: jest.fn(), sendMahjongForfeitNotice: jest.fn() }));
jest.mock("@/lib/switchbot", () => ({ deletePasscodeByName: jest.fn() }));
jest.mock("@/lib/adminNotify", () => ({ notifyAdmin: jest.fn() }));
import { cancelDay } from "@/lib/mahjongForfeit";
import { DELETE } from "@/app/api/reservations/[id]/route";
import { refundSquarePayment } from "@/lib/square";
import { notifyAdmin } from "@/lib/adminNotify";
import { GET as mahjong } from "@/app/api/admin/mahjong/refunds/route";
import { GET as darts } from "@/app/api/admin/darts/refunds/route";
import { GET as billiards } from "@/app/api/admin/billiards/refunds/route";
import { GET as poker } from "@/app/api/admin/poker/refunds/route";

beforeEach(() => {
  store.clear(); jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(new Date("2026-09-25T03:00:00Z"));
});
afterEach(() => jest.useRealTimers());
test("麻雀流会は返金待ちにするだけでSquare返金を呼ばない", async () => {
  store.set("mahjongEntries/e1", { seasonId: "s1", eventDate: "2026-10-10", lineUserId: "U1", status: "paid", paymentStatus: "paid", paymentTransactionId: "order-1" });
  expect(await cancelDay("s1", "2026-10-10", "GM")).toEqual({ status: "forfeited", paidCount: 1, refundCount: 1 });
  expect(store.get("mahjongEntries/e1")).toMatchObject({ status: "cancelRequested", cancelReason: "forfeit" });
  expect(notifyAdmin).toHaveBeenCalled();
  expect(refundSquarePayment).not.toHaveBeenCalled();
});
test("施設予約キャンセルは管理者通知のみでSquare返金を呼ばない", async () => {
  store.set("reservations/r1", { lineUserId: "U1", status: "confirmed", facilityId: "f1", facilityName: "施設", date: "2026-10-10", startTime: "10:00", endTime: "12:00", paymentTransactionId: "order-1" });
  const res = await DELETE(new NextRequest("http://localhost/api/reservations/r1", { method: "DELETE" }), { params: Promise.resolve({ id: "r1" }) });
  expect(res.status).toBe(200);
  expect(store.get("reservations/r1")?.status).toBe("cancelled");
  expect(notifyAdmin).toHaveBeenCalledWith("trailer_cancel", expect.any(String), expect.objectContaining({ paymentTransactionId: "order-1" }));
  expect(refundSquarePayment).not.toHaveBeenCalled();
});
test.each([["mahjong", mahjong], ["darts", darts], ["billiards", billiards], ["poker", poker]] as const)("%s 管理返金一覧で自動返金済みはpendingに出ない", async (game, get) => {
  store.set(`${game}Entries/auto`, { status: "refunded", paymentStatus: "cancelRequested", refundMethod: "auto", cancelReason: "self", paymentAmount: 1500 });
  expect(store.get(`${game}Entries/auto`)?.paymentStatus).toBe("cancelRequested");
  store.set(`${game}Entries/manual`, { status: "cancelRequested", paymentStatus: "cancelRequested" });
  const res = await get(new NextRequest(`http://localhost/api/admin/${game}/refunds`));
  expect(res.status).toBe(200);
  const { items } = await res.json();
  expect(items).toEqual(expect.arrayContaining([expect.objectContaining({ entryId: "auto", state: "refunded", forfeit: false })]));
  expect(items.filter((i: { state: string }) => i.state === "pending").map((i: { entryId: string }) => i.entryId)).toEqual(["manual"]);
  expect(refundSquarePayment).not.toHaveBeenCalled();
});
