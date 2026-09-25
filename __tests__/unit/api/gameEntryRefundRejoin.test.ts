jest.mock("@/lib/monthlyEntryExempt", () => ({
  ...jest.requireActual("@/lib/monthlyEntryExempt"), MONTHLY_ENTRY_LIMIT_ENABLED: true,
}));
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/auth", () => ({ requireGameUserWithRole: jest.fn() }));
jest.mock("@/lib/mahjong", () => ({ getActiveSeason: async () => ({ seasonId: "S1" }) }));
jest.mock("@/lib/mahjongDay", () => ({ getDayState: async () => null, isEntryClosed: () => false }));
jest.mock("@/lib/dartsSchedule", () => ({ isScheduledDartsDate: async () => true, isDartsCancelledDate: async () => false }));
jest.mock("@/lib/dartsDay", () => ({ getDartsDayState: async () => null, isDartsEntryClosed: () => false }));
jest.mock("@/lib/entryDeadline", () => ({ isEntryClosedByTime: async () => false }));
jest.mock("@/lib/gameSchedule", () => ({ isScheduleDateBlockedInTx: async () => false }));
jest.mock("@/lib/square", () => ({ createReservationPaymentLink: async () => ({ url: "https://square.link/pay", orderId: "ORDER" }) }));
jest.mock("@/lib/liffUrl", () => ({ liffUrl: (p: string) => `https://liff.example${p}` }));
jest.mock("@/lib/billiardsSchedule", () => ({ isScheduledBilliardsDate: async () => true, isBilliardsCancelledDate: async () => false }));
jest.mock("@/lib/pokerSchedule", () => ({ isScheduledPokerDate: async () => true, isPokerCancelledDate: async () => false }));
import { MAHJONG_ENTRY_FEE } from "@/types";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUserWithRole } from "@/lib/auth";
import * as mahjong from "@/app/api/mahjong/entries/route";
import * as darts from "@/app/api/darts/entries/route";
import * as billiards from "@/app/api/billiards/entries/route";
import * as poker from "@/app/api/poker/entries/route";
import { makeDb } from "../../helpers/scheduleDb";
import { NextRequest } from "next/server";
const DATE = "2026-10-10", ID = `S1_${DATE}_U1`;
const stale = ["paymentStatus", "paymentTransactionId", "paymentUrl", "pendingExpiresAt", "paidAt", "refundedAt", "squareRefundId", "squareRefundStatus", "refundMethod", "cancelReason", "cancelRequestedAt", "refundProcessedAt", "refundProcessedBy", "paymentAmount", "squarePaymentId", "squareReceiptUrl", "squareVerifiedAt"];
let db: ReturnType<typeof makeDb>;
function seed(game: string, id = ID, extra = {}) {
  const entry = { seasonId: "S1", eventDate: DATE, lineUserId: "U1", enteredAt: "old", displayName: "user", status: "refunded", ...Object.fromEntries(stale.map(f => [f, "old"])), paymentStatus: "cancelRequested", ...extra };
  db.__set(`${game}Entries`, id, entry);
  return entry;
}
const req = (query = "") => new NextRequest(`http://localhost/api/entries${query}`, { method: query ? "GET" : "POST", ...(query ? {} : { body: JSON.stringify({ eventDate: DATE }) }) });
beforeEach(() => {
  db = makeDb();
  (getDb as jest.Mock).mockReturnValue(db);
  (requireGameUserWithRole as jest.Mock).mockResolvedValue({ lineUserId: "U1", role: "staff", monthlyEntryExempt: false });
  db.__set("mahjongSchedule", DATE, { seasonId: "S1", date: DATE });
});
describe.each([["mahjong", mahjong, 8], ["darts", darts, 8], ["billiards", billiards, 8], ["poker", poker, 9]] as const)("%s 返金後の再参加", (game, route, capacity) => {
  test("staff再参加で前サイクルの全決済フィールドを除去", async () => {
    seed(game);
    expect((await route.POST(req())).status).toBe(201);
    const saved = db.__get(`${game}Entries`, ID)!;
    expect(saved.status).toBe("paid");
    for (const field of stale) expect(saved).not.toHaveProperty(field);
  });
  test("返金済みの他人を定員から除外", async () => {
    for (let i = 0; i < capacity; i++) seed(game, `other${i}`, { lineUserId: `other${i}` });
    expect((await route.POST(req())).status).toBe(201);
  });
  test("再参加時に満員ならentry不変", async () => {
    const before = seed(game);
    for (let i = 0; i < capacity; i++) seed(game, `other${i}`, { lineUserId: `other${i}`, status: "paid", paymentStatus: "paid" });
    const res = await route.POST(req());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ full: true });
    expect(db.__get(`${game}Entries`, ID)).toEqual(before);
  });
  test("再参加時は別日の月ロックを再判定", async () => {
    seed(game);
    seed(game, "S1_2026-10-17_U1", { eventDate: "2026-10-17", status: "paid", paymentStatus: "paid" });
    db.__set(`${game}MonthlyLocks`, "S1_U1_2026-10", { eventDate: "2026-10-17" });
    const res = await route.POST(req());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ monthlyLimit: true });
  });
});
describe.each([["darts", darts, 8], ["billiards", billiards, 8], ["poker", poker, 9]] as const)("%s GET", (game, route, capacity) => {
  test.each(["paid", "cancelRequested"])("返金済み(paymentStatus=%s)を全一覧・判定から除外", async (paymentStatus) => {
    seed(game, ID, { paymentStatus });
    for (let i = 0; i < capacity - 1; i++) seed(game, `other${i}`, { lineUserId: `other${i}`, status: "paid", paymentStatus: "paid" });
    expect(await (await route.GET(req("?mine=1"))).json()).toMatchObject({ entries: [] });
    const body = await (await route.GET(req(`?eventDate=${DATE}`))).json();
    expect(body).toMatchObject({ entered: false, full: false, count: capacity - 1, me: { entered: false, paymentStatus: null } });
    expect(body.entries).toHaveLength(capacity - 1);
  });
});
test("麻雀の会員再参加では新しいpending決済だけを残す", async () => {
  (requireGameUserWithRole as jest.Mock).mockResolvedValue({ lineUserId: "U1", role: "member" });
  seed("mahjong");
  expect((await mahjong.POST(req())).status).toBe(201);
  const saved = db.__get("mahjongEntries", ID)!;
  expect(saved).toMatchObject({ status: "reserved", paymentStatus: "pending", paymentTransactionId: "ORDER" });
  expect(saved.paymentAmount).toBe(MAHJONG_ENTRY_FEE);
  for (const field of stale.slice(4).filter(field => field !== "paymentAmount")) expect(saved).not.toHaveProperty(field);
});
