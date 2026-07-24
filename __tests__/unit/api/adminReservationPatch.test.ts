/**
 * 単体テスト: PATCH /api/admin/reservations/[id]（日時変更のGCal追随＋ロック付け替え）。
 * In-memory Firestore モック。Google Calendar / facilities / adminAuth はモック。
 *
 * 検証（完了条件）:
 *  - 日時変更で reservationLocks が旧→新スロットへ移る（古い枠が塞がったままにならない）
 *  - GCal イベントが新しい時間で更新される（updateCalendarEvent 呼び出し）
 *  - 変更先が予約済みなら 409（ロック・予約は不変）
 *  - GCal 更新失敗時は Firestore を旧状態へ巻き戻す（不整合を残さない）
 */
import { buildReservationSlotKey } from "@/lib/reservations";

jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/adminAuth", () => ({ checkAdminAuth: jest.fn().mockResolvedValue(true) }));
jest.mock("@/lib/switchbot", () => ({ deletePasscode: jest.fn() }));
jest.mock("@/lib/facilities", () => ({
  getFacilityById: jest.fn().mockResolvedValue({ id: "room-a", name: "会議室A", calendarId: "cal-a" }),
}));
jest.mock("@/lib/googleCalendar", () => ({
  updateCalendarEvent: jest.fn().mockResolvedValue(undefined),
  createCalendarEvent: jest.fn().mockResolvedValue("new-event-id"),
  deleteCalendarEvent: jest.fn().mockResolvedValue(undefined),
}));

import { getDb } from "@/lib/firebaseAdmin";
import { updateCalendarEvent } from "@/lib/googleCalendar";
import { PATCH } from "@/app/api/admin/reservations/[id]/route";
import type { NextRequest } from "next/server";

/* ───────── In-memory Firestore モック（doc + query + transaction） ───────── */
type Data = Record<string, unknown>;
function makeDb() {
  const store = new Map<string, Map<string, Data>>();
  const col = (n: string) => {
    if (!store.has(n)) store.set(n, new Map());
    return store.get(n)!;
  };
  const mut = {
    set: (c: string, id: string, d: Data) => col(c).set(id, { ...d }),
    update: (c: string, id: string, d: Data) => col(c).set(id, { ...(col(c).get(id) ?? {}), ...d }),
    delete: (c: string, id: string) => col(c).delete(id),
  };
  const docRef = (c: string, id: string) => ({
    __c: c,
    id,
    get: async () => ({ exists: col(c).has(id), id, data: () => col(c).get(id) }),
    update: async (d: Data) => mut.update(c, id, d),
    set: async (d: Data) => mut.set(c, id, d),
    delete: async () => mut.delete(c, id),
  });
  const runQuery = (c: string, filters: [string, unknown][]) => {
    const docs = Array.from(col(c).entries())
      .filter(([, d]) => filters.every(([f, v]) => d[f] === v))
      .map(([id, d]) => ({ id, data: () => d }));
    return { docs, size: docs.length, empty: docs.length === 0 };
  };
  const query = (c: string, filters: [string, unknown][]) => ({
    __c: c,
    __filters: filters,
    where: (f: string, _o: string, v: unknown) => query(c, [...filters, [f, v]]),
    get: async () => runQuery(c, filters),
  });
  const tx = {
    get: async (ref: { __filters?: [string, unknown][]; __c: string; get?: () => Promise<unknown> }) => {
      if (ref.__filters !== undefined) return runQuery(ref.__c, ref.__filters);
      return (ref as { get: () => Promise<unknown> }).get();
    },
    set: (ref: { __c: string; id: string }, d: Data) => mut.set(ref.__c, ref.id, d),
    update: (ref: { __c: string; id: string }, d: Data) => mut.update(ref.__c, ref.id, d),
    delete: (ref: { __c: string; id: string }) => mut.delete(ref.__c, ref.id),
  };
  return {
    collection: (n: string) => ({
      doc: (id: string) => docRef(n, id),
      where: (f: string, _o: string, v: unknown) => query(n, [[f, v]]),
    }),
    runTransaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
    __store: store,
  };
}

const FAC = "room-a";
const RID = "res-1";
const oldKey = buildReservationSlotKey(FAC, "2026-07-11", "10:00", "11:00");
let db: ReturnType<typeof makeDb>;

function seedConfirmed() {
  db.__store.set(
    "reservations",
    new Map([[RID, { facilityId: FAC, date: "2026-07-11", startTime: "10:00", endTime: "11:00", status: "confirmed", googleEventId: "ev-1", lineUserId: "u1" }]])
  );
  db.__store.set(
    "reservationLocks",
    new Map([[oldKey, { facilityId: FAC, date: "2026-07-11", startTime: "10:00", endTime: "11:00", status: "confirmed", reservationId: RID, lineUserId: "u1" }]])
  );
}
const lockAt = (start: string, end: string) => db.__store.get("reservationLocks")!.get(buildReservationSlotKey(FAC, "2026-07-11", start, end));
const reservation = () => db.__store.get("reservations")!.get(RID)!;
const req = (body: Data) => ({ json: async () => body } as unknown as NextRequest);

beforeEach(() => {
  db = makeDb();
  (getDb as jest.Mock).mockReturnValue(db);
  (updateCalendarEvent as jest.Mock).mockClear().mockResolvedValue(undefined);
  seedConfirmed();
});

test("日時変更でロックが旧→新へ移り、GCalが新時間で更新される", async () => {
  const res = await PATCH(req({ startTime: "13:00", endTime: "14:00" }), { params: { id: RID } });
  expect(res.status).toBe(200);
  // 旧ロック削除・新ロック作成（confirmed）
  expect(lockAt("10:00", "11:00")).toBeUndefined();
  expect(lockAt("13:00", "14:00")).toMatchObject({ status: "confirmed", reservationId: RID, startTime: "13:00", endTime: "14:00" });
  // 予約doc更新
  expect(reservation()).toMatchObject({ date: "2026-07-11", startTime: "13:00", endTime: "14:00" });
  // GCal は新時間で更新
  expect(updateCalendarEvent).toHaveBeenCalledWith("cal-a", "ev-1", { date: "2026-07-11", startTime: "13:00", endTime: "14:00" });
});

test("変更先が予約済みなら 409・ロックと予約は不変", async () => {
  // 別予約のロックを 13:00-14:00 に置く
  db.__store.get("reservationLocks")!.set(buildReservationSlotKey(FAC, "2026-07-11", "13:00", "14:00"), {
    facilityId: FAC, date: "2026-07-11", startTime: "13:00", endTime: "14:00", status: "confirmed", reservationId: "other",
  });
  const res = await PATCH(req({ startTime: "13:30", endTime: "14:00" }), { params: { id: RID } });
  expect(res.status).toBe(409);
  // 旧ロックは残り、予約も元のまま
  expect(lockAt("10:00", "11:00")).toBeTruthy();
  expect(reservation()).toMatchObject({ startTime: "10:00", endTime: "11:00" });
  expect(updateCalendarEvent).not.toHaveBeenCalled();
});

test("GCal更新失敗時は Firestore を旧状態へ巻き戻す（502）", async () => {
  (updateCalendarEvent as jest.Mock).mockRejectedValueOnce(new Error("gcal down"));
  const res = await PATCH(req({ startTime: "13:00", endTime: "14:00" }), { params: { id: RID } });
  expect(res.status).toBe(502);
  // ロック・予約は旧状態へ復元
  expect(lockAt("13:00", "14:00")).toBeUndefined();
  expect(lockAt("10:00", "11:00")).toMatchObject({ status: "confirmed", startTime: "10:00", endTime: "11:00" });
  expect(reservation()).toMatchObject({ startTime: "10:00", endTime: "11:00" });
});

test("確定済み以外は 409", async () => {
  db.__store.get("reservations")!.set(RID, { ...reservation(), status: "cancelled" });
  const res = await PATCH(req({ startTime: "13:00", endTime: "14:00" }), { params: { id: RID } });
  expect(res.status).toBe(409);
});

test("同一スロット（変更なし）は成功しGCalを呼ばない", async () => {
  const res = await PATCH(req({ startTime: "10:00", endTime: "11:00" }), { params: { id: RID } });
  expect(res.status).toBe(200);
  expect(updateCalendarEvent).not.toHaveBeenCalled();
});
