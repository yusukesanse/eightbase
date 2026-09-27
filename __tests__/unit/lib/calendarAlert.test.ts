jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/adminNotify", () => ({ notifyAdmin: jest.fn() }));
import { getDb } from "@/lib/firebaseAdmin";
import { notifyAdmin } from "@/lib/adminNotify";
import { notifyCalendarUnreadable, CALENDAR_ALERT_THROTTLE_MS } from "@/lib/calendarAlert";
type Data = Record<string, unknown>;

function makeDb() {
  const store = new Map<string, Map<string, Data>>();
  const col = (n: string) => {
    if (!store.has(n)) store.set(n, new Map());
    return store.get(n)!;
  };
  const docRef = (c: string, id: string) => ({
    __c: c,
    id,
    get: async () => ({ exists: col(c).has(id), id, data: () => col(c).get(id) }),
  });
  const query = (c: string, conds: [string, unknown][]) => ({
    where: (f: string, _op: string, v: unknown) => query(c, [...conds, [f, v]]),
    get: async () => {
      const docs = [...col(c).entries()]
        .filter(([, v]) => conds.every(([f, val]) => v[f] === val))
        .map(([id, v]) => ({ id, data: () => v }));
      return { docs, empty: docs.length === 0, size: docs.length };
    },
  });
  return {
    __seed: (c: string, id: string, d: Data) => { col(c).set(id, d); },
    __get: (c: string, id: string) => col(c).get(id),
    collection: (c: string) => ({
      doc: (id: string) => docRef(c, id),
      where: (f: string, _op: string, v: unknown) => query(c, [[f, v]]),
    }),
    runTransaction: async <T,>(fn: (tx: {
      get: (ref: ReturnType<typeof docRef>) => ReturnType<ReturnType<typeof docRef>["get"]>;
      set: (ref: ReturnType<typeof docRef>, d: Data, opt?: { merge?: boolean }) => void;
    }) => Promise<T>): Promise<T> =>
      fn({
        get: (ref) => ref.get(),
        set: (ref, d, opt) => {
          const cur = opt?.merge ? (col(ref.__c).get(ref.id) ?? {}) : {};
          col(ref.__c).set(ref.id, { ...cur, ...d });
        },
      }),
  };
}


beforeEach(() => { jest.resetAllMocks(); });
test("first read failure notifies, throttles before six hours, notifies at six hours", async () => {
  const db = makeDb();
  (getDb as jest.Mock).mockReturnValue(db);
  await notifyCalendarUnreadable("room", "会議室", 1000);
  expect(notifyAdmin).toHaveBeenCalledTimes(1);
  expect(notifyAdmin).toHaveBeenCalledWith("calendar_unreadable", "施設「会議室」のGoogleカレンダーが読み取れません。共有設定を確認してください。", { facilityId: "room" });
  expect(db.__get("calendarAlerts", "room")).toEqual({ facilityId: "room", lastNotifiedAtMs: 1000 });
  await notifyCalendarUnreadable("room", "会議室", 1000 + CALENDAR_ALERT_THROTTLE_MS - 1000);
  expect(notifyAdmin).toHaveBeenCalledTimes(1);
  await notifyCalendarUnreadable("room", "会議室", 1000 + CALENDAR_ALERT_THROTTLE_MS);
  expect(notifyAdmin).toHaveBeenCalledTimes(2);
});
test("notification rejection does not escape", async () => {
  (getDb as jest.Mock).mockReturnValue(makeDb());
  (notifyAdmin as jest.Mock).mockRejectedValue(new Error("notify failed"));
  await expect(notifyCalendarUnreadable("room", undefined, 0)).resolves.toBeUndefined();
  expect(notifyAdmin).toHaveBeenCalledTimes(1);
});
test("database failure does not escape", async () => {
  (getDb as jest.Mock).mockImplementation(() => { throw new Error("db failed"); });
  await expect(notifyCalendarUnreadable("room", undefined, 0)).resolves.toBeUndefined();
});
