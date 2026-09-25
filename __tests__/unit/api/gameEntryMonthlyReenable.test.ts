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
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUserWithRole } from "@/lib/auth";
import { POST as mahjongPost } from "@/app/api/mahjong/entries/route";
import { POST as dartsPost } from "@/app/api/darts/entries/route";
import { isMonthlyBlocked, canJoinDate } from "@/lib/mahjongJoinCalendar";
import { makeDb } from "../../helpers/scheduleDb";
import type { NextRequest } from "next/server";
const FIRST = "2026-10-03", SECOND = "2026-10-10";
const req = (eventDate: string) => ({ json: async () => ({ eventDate }), headers: new Headers({ origin: "https://app.example" }), nextUrl: new URL("https://app.example") }) as NextRequest;
let db: ReturnType<typeof makeDb>;
function setUser(monthlyEntryExempt: boolean) {
  (requireGameUserWithRole as jest.Mock).mockResolvedValue({ lineUserId: "U1", role: "member", monthlyEntryExempt });
}
beforeEach(() => {
  db = makeDb(); (getDb as jest.Mock).mockReturnValue(db);
  setUser(false);
  for (const date of [FIRST, SECOND]) db.__set("mahjongSchedule", date, { seasonId: "S1", date });
});
describe.each([["mahjong", mahjongPost], ["darts", dartsPost]] as const)("%s: 月制限再有効化", (game, post) => {
  test("免除なしは同月別日に409とmonthlyLimitを返す", async () => {
    expect((await post(req(FIRST))).status).toBe(201);
    const res = await post(req(SECOND));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ monthlyLimit: true });
  });
  test("免除ありは同月別日も201", async () => {
    setUser(true);
    expect((await post(req(FIRST))).status).toBe(201);
    expect((await post(req(SECOND))).status).toBe(201);
  });
  test("削除済みentryを指すstaleロックは自己回復する", async () => {
    expect((await post(req(FIRST))).status).toBe(201);
    await db.collection(`${game}Entries`).doc(`S1_${FIRST}_U1`).delete();
    expect((await post(req(SECOND))).status).toBe(201);
    expect(db.__get(`${game}MonthlyLocks`, "S1_U1_2026-10")?.eventDate).toBe(SECOND);
  });
});
test.each([false, true])("カレンダー再有効化: 免除=%s", (monthlyExempt) => {
  const enteredDates = new Set([FIRST]);
  expect(isMonthlyBlocked(SECOND, enteredDates, monthlyExempt)).toBe(!monthlyExempt);
  expect(canJoinDate(SECOND, { today: "2026-10-01", enteredDates, closedDates: new Set(), cancelledDates: new Set(), scheduledDates: new Set([FIRST, SECOND]), full: false, monthlyExempt })).toBe(monthlyExempt);
});
