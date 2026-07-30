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
jest.mock("@/lib/switchbot", () => ({
  deletePasscodeByName: jest.fn().mockResolvedValue(1),
  issueTimeLimitPasscodeWithRetry: jest.fn().mockResolvedValue({ keyId: 77, keypadDeviceId: "KP" }),
}));
jest.mock("@/lib/adminNotify", () => ({ notifyAdmin: jest.fn().mockResolvedValue(undefined) }));
// モックしないと実際に LINE API を叩いてしまう（jest.setup.ts がトークンを入れているため）
jest.mock("@/lib/line", () => ({ sendReservationRescheduled: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/reservationAudit", () => ({ writeReservationAudit: jest.fn().mockResolvedValue(undefined) }));
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
import { getFacilityById } from "@/lib/facilities";
import { deletePasscodeByName, issueTimeLimitPasscodeWithRetry } from "@/lib/switchbot";
import { notifyAdmin } from "@/lib/adminNotify";
import { sendReservationRescheduled } from "@/lib/line";
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
  // 施設は既定で SwitchBot 未連携（＝パスコード処理を通らない状態）に戻す
  (getFacilityById as jest.Mock).mockResolvedValue({ id: FAC, name: "会議室A", calendarId: "cal-a" });
  (deletePasscodeByName as jest.Mock).mockClear().mockResolvedValue(1);
  (issueTimeLimitPasscodeWithRetry as jest.Mock)
    .mockClear()
    .mockResolvedValue({ keyId: 77, keypadDeviceId: "KP" });
  (notifyAdmin as jest.Mock).mockClear();
  (sendReservationRescheduled as jest.Mock).mockClear().mockResolvedValue(undefined);
  seedConfirmed();
});

test("日時変更でロックが旧→新へ移り、GCalが新時間で更新される", async () => {
  const res = await PATCH(req({ startTime: "13:00", endTime: "14:00" }), { params: Promise.resolve({ id: RID }) });
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
  const res = await PATCH(req({ startTime: "13:30", endTime: "14:00" }), { params: Promise.resolve({ id: RID }) });
  expect(res.status).toBe(409);
  // 旧ロックは残り、予約も元のまま
  expect(lockAt("10:00", "11:00")).toBeTruthy();
  expect(reservation()).toMatchObject({ startTime: "10:00", endTime: "11:00" });
  expect(updateCalendarEvent).not.toHaveBeenCalled();
});

test("GCal更新失敗時は Firestore を旧状態へ巻き戻す（502）", async () => {
  (updateCalendarEvent as jest.Mock).mockRejectedValueOnce(new Error("gcal down"));
  const res = await PATCH(req({ startTime: "13:00", endTime: "14:00" }), { params: Promise.resolve({ id: RID }) });
  expect(res.status).toBe(502);
  // ロック・予約は旧状態へ復元
  expect(lockAt("13:00", "14:00")).toBeUndefined();
  expect(lockAt("10:00", "11:00")).toMatchObject({ status: "confirmed", startTime: "10:00", endTime: "11:00" });
  expect(reservation()).toMatchObject({ startTime: "10:00", endTime: "11:00" });
});

test("確定済み以外は 409", async () => {
  db.__store.get("reservations")!.set(RID, { ...reservation(), status: "cancelled" });
  const res = await PATCH(req({ startTime: "13:00", endTime: "14:00" }), { params: Promise.resolve({ id: RID }) });
  expect(res.status).toBe(409);
});

test("同一スロット（変更なし）は成功しGCalを呼ばない", async () => {
  const res = await PATCH(req({ startTime: "10:00", endTime: "11:00" }), { params: Promise.resolve({ id: RID }) });
  expect(res.status).toBe(200);
  expect(updateCalendarEvent).not.toHaveBeenCalled();
});

/* ───────── 利用者への日時変更通知 ───────── */
describe("日時変更の通知", () => {
  test("変更前後の日時を添えて利用者へ通知する", async () => {
    await PATCH(req({ startTime: "13:00", endTime: "14:00" }), { params: Promise.resolve({ id: RID }) });
    expect(sendReservationRescheduled).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        oldDate: "2026-07-11",
        oldStartTime: "10:00",
        oldEndTime: "11:00",
        date: "2026-07-11",
        startTime: "13:00",
        endTime: "14:00",
        hasPasscode: false,
      })
    );
  });

  test("変更なし（同一スロット）では通知しない", async () => {
    await PATCH(req({ startTime: "10:00", endTime: "11:00" }), { params: Promise.resolve({ id: RID }) });
    expect(sendReservationRescheduled).not.toHaveBeenCalled();
  });

  test("409（変更先が予約済み）では通知しない", async () => {
    db.__store.get("reservationLocks")!.set(buildReservationSlotKey(FAC, "2026-07-11", "13:00", "14:00"), {
      facilityId: FAC, date: "2026-07-11", startTime: "13:00", endTime: "14:00", status: "confirmed", reservationId: "other",
    });
    await PATCH(req({ startTime: "13:30", endTime: "14:00" }), { params: Promise.resolve({ id: RID }) });
    expect(sendReservationRescheduled).not.toHaveBeenCalled();
  });

  test("通知が失敗しても日時変更は成功のまま（巻き戻さない）", async () => {
    (sendReservationRescheduled as jest.Mock).mockRejectedValueOnce(new Error("line down"));
    const res = await PATCH(req({ startTime: "13:00", endTime: "14:00" }), { params: Promise.resolve({ id: RID }) });
    expect(res.status).toBe(200);
    expect(reservation()).toMatchObject({ startTime: "13:00", endTime: "14:00" });
  });
});

/* ───────── 解錠パスコードの有効期間の貼り替え（トレーラー等） ───────── */
describe("解錠パスコードの追随", () => {
  /** SwitchBot 連携済みの施設＋パスコード発行済みの予約にする */
  function seedWithPasscode() {
    (getFacilityById as jest.Mock).mockResolvedValue({
      id: FAC,
      name: "トレーラー",
      calendarId: "cal-a",
      switchBotDeviceId: "KEYPAD-1",
    });
    db.__store.get("reservations")!.set(RID, {
      ...reservation(),
      switchBotPasscode: "123456",
      switchBotKeyId: 42,
      switchBotStatus: "issued",
      switchBotPasscodeExpiresAt: "2026-07-11T02:00:00.000Z",
    });
  }

  test("日時変更で旧キーを消し、同じコードで新しい有効期間に貼り替える", async () => {
    seedWithPasscode();
    const res = await PATCH(req({ startTime: "13:00", endTime: "14:00" }), {
      params: Promise.resolve({ id: RID }),
    });
    expect(res.status).toBe(200);

    // 先に name（予約ID）で削除している＝消し漏れると createKey が既存を返してしまう
    expect(deletePasscodeByName).toHaveBeenCalledWith("KEYPAD-1", RID);
    // 同じパスコードを使い回す（利用者へ配り直さない）
    expect(issueTimeLimitPasscodeWithRetry).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: "KEYPAD-1", name: RID, password: "123456" })
    );
    // 窓は新しい日時（JST 13:00〜14:00）
    const arg = (issueTimeLimitPasscodeWithRetry as jest.Mock).mock.calls[0][0];
    expect(arg.startMs).toBe(new Date("2026-07-11T13:00:00+09:00").getTime());
    expect(arg.endMs).toBe(new Date("2026-07-11T14:00:00+09:00").getTime());
    // 予約docの有効期限・keyId・status が更新される
    expect(reservation()).toMatchObject({
      switchBotKeyId: 77,
      switchBotStatus: "issued",
      switchBotPasscodeExpiresAt: new Date("2026-07-11T14:00:00+09:00").toISOString(),
    });
    // 「コードはそのまま使える」と案内する
    expect(sendReservationRescheduled).toHaveBeenCalledWith("u1", expect.objectContaining({ hasPasscode: true }));
  });

  test("貼り替えに失敗しても日時変更は維持し、failed にして管理者へ通知する", async () => {
    seedWithPasscode();
    (issueTimeLimitPasscodeWithRetry as jest.Mock).mockRejectedValueOnce(new Error("switchbot down"));
    const res = await PATCH(req({ startTime: "13:00", endTime: "14:00" }), {
      params: Promise.resolve({ id: RID }),
    });
    // 予約の移動が主目的なので巻き戻さない
    expect(res.status).toBe(200);
    expect(reservation()).toMatchObject({ startTime: "13:00", endTime: "14:00", switchBotStatus: "failed" });
    expect(lockAt("13:00", "14:00")).toBeTruthy();
    // 黙って捨てない（利用者が入れない状態なので必ず通知）
    expect(notifyAdmin).toHaveBeenCalledWith(
      "switchbot_failed",
      expect.stringContaining("解錠コード"),
      expect.objectContaining({ reservationId: RID })
    );
    expect(await res.json()).toMatchObject({ passcodeWarning: expect.any(String) });
    // 貼り替え失敗時は「コードはそのまま使える」と案内してはいけない（実際は使えない）
    expect(sendReservationRescheduled).toHaveBeenCalledWith("u1", expect.objectContaining({ hasPasscode: false }));
  });

  test("パスコード未発行の予約では SwitchBot を叩かない（既存施設の回帰）", async () => {
    // seedConfirmed のまま（switchBotPasscode なし・施設に deviceId なし）
    const res = await PATCH(req({ startTime: "13:00", endTime: "14:00" }), {
      params: Promise.resolve({ id: RID }),
    });
    expect(res.status).toBe(200);
    expect(deletePasscodeByName).not.toHaveBeenCalled();
    expect(issueTimeLimitPasscodeWithRetry).not.toHaveBeenCalled();
  });
});
