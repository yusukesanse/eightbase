/**
 * 単体テスト: src/lib/reservations.ts の getBlockingLockedSlots
 * （空き表示の真実の源＝confirmed ＋ 未失効 pending の全ブロッキングロック）。
 */
import { getBlockingLockedSlots } from "@/lib/reservations";

type Lock = Record<string, unknown>;
function mockDb(locks: Lock[]) {
  const q = {
    where: () => q,
    get: async () => ({ docs: locks.map((l) => ({ data: () => l })) }),
  };
  return { collection: () => ({ where: () => q }) } as unknown as FirebaseFirestore.Firestore;
}

const NOW = "2026-07-01T12:00:00.000Z";
const base = { facilityId: "f", date: "2026-07-01" };

test("confirmed と 未失効pending を返し、cancelled と 失効pending は除外する", async () => {
  const db = mockDb([
    { ...base, startTime: "10:00", endTime: "11:00", status: "confirmed" },
    { ...base, startTime: "11:00", endTime: "12:00", status: "pending", pendingExpiresAt: "2026-07-01T12:10:00.000Z" }, // 未失効
    { ...base, startTime: "13:00", endTime: "14:00", status: "pending", pendingExpiresAt: "2026-07-01T11:50:00.000Z" }, // 失効→除外
    { ...base, startTime: "15:00", endTime: "16:00", status: "cancelled" }, // 除外
  ]);
  const slots = await getBlockingLockedSlots(db, "f", "2026-07-01", NOW);
  expect(slots).toEqual([
    { start: "10:00", end: "11:00" },
    { start: "11:00", end: "12:00" },
  ]);
});

test("startTime/endTime が欠けたロックは無視する", async () => {
  const db = mockDb([{ ...base, status: "confirmed" }]);
  expect(await getBlockingLockedSlots(db, "f", "2026-07-01", NOW)).toEqual([]);
});
