/**
 * 単体テスト: 管理カレンダーの休催API `/api/admin/games/day`（In-memory Firestore モック）。
 * - POST: ゲーム別に正しい cancel 関数へ dispatch し、状態(started/finished/closed/already/forfeited)を
 *   正しい HTTP ステータスへマップする。バリデーション(400)。
 * - GET: 参加者の導出（paid/reserved/refundable）・件数・休催フラグ。list=1 で休催日一覧。
 */
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/adminAuth", () => ({ checkAdminAuth: jest.fn().mockResolvedValue("admin@test.com") }));
jest.mock("@/lib/auditLog", () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/mahjongForfeit", () => ({ cancelDay: jest.fn() }));
jest.mock("@/lib/dartsDay", () => ({ cancelDartsDay: jest.fn() }));
jest.mock("@/lib/billiardsDay", () => ({ cancelBilliardsDay: jest.fn() }));
jest.mock("@/lib/pokerDay", () => ({ cancelPokerDay: jest.fn() }));

import { NextRequest } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { cancelDay } from "@/lib/mahjongForfeit";
import { cancelDartsDay } from "@/lib/dartsDay";
import { cancelBilliardsDay } from "@/lib/billiardsDay";
import { GET, POST } from "@/app/api/admin/games/day/route";

type Data = Record<string, unknown>;
function makeDb() {
  const store = new Map<string, Map<string, Data>>();
  const col = (n: string) => { if (!store.has(n)) store.set(n, new Map()); return store.get(n)!; };
  const runQuery = (c: string, f: [string, unknown][]) => {
    const docs = Array.from(col(c).entries())
      .filter(([, d]) => f.every(([k, v]) => d[k] === v))
      .map(([id, d]) => ({ id, data: () => d }));
    return { docs, size: docs.length, empty: docs.length === 0 };
  };
  const query = (c: string, f: [string, unknown][]) => ({
    where: (k: string, _o: string, v: unknown) => query(c, [...f, [k, v]]),
    get: async () => runQuery(c, f),
  });
  return {
    collection: (n: string) => ({
      doc: (id: string) => ({ get: async () => ({ exists: col(n).has(id), data: () => col(n).get(id) }) }),
      where: (k: string, _o: string, v: unknown) => query(n, [[k, v]]),
    }),
    __store: store,
    __seed: (c: string, id: string, d: Data) => col(c).set(id, d),
  };
}

let db: ReturnType<typeof makeDb>;
beforeEach(() => {
  db = makeDb();
  (getDb as jest.Mock).mockReturnValue(db);
  (cancelDay as jest.Mock).mockReset();
  (cancelDartsDay as jest.Mock).mockReset();
  (cancelBilliardsDay as jest.Mock).mockReset();
});

const postReq = (body: unknown) =>
  new NextRequest("http://localhost/api/admin/games/day", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const getReq = (qs: string) => new NextRequest(`http://localhost/api/admin/games/day?${qs}`);

describe("POST /api/admin/games/day（休催化 dispatch）", () => {
  test("darts は cancelDartsDay を呼び forfeited を 200+refundCount にマップ", async () => {
    (cancelDartsDay as jest.Mock).mockResolvedValue({ status: "forfeited", paidCount: 3, refundCount: 2 });
    const res = await POST(postReq({ gameCategory: "darts", seasonId: "s1", eventDate: "2026-07-16" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, refundCount: 2, paidCount: 3 });
    expect(cancelDartsDay).toHaveBeenCalledWith("s1", "2026-07-16", "admin:admin@test.com");
    expect(cancelDay).not.toHaveBeenCalled();
    expect(cancelBilliardsDay).not.toHaveBeenCalled();
  });

  test("billiards は cancelBilliardsDay を呼ぶ", async () => {
    (cancelBilliardsDay as jest.Mock).mockResolvedValue({ status: "forfeited", paidCount: 0, refundCount: 0 });
    const res = await POST(postReq({ gameCategory: "billiards", seasonId: "s1", eventDate: "2026-07-18" }));
    expect(res.status).toBe(200);
    expect(cancelBilliardsDay).toHaveBeenCalledWith("s1", "2026-07-18", "admin:admin@test.com");
  });

  test("mahjong は cancelDay を呼ぶ", async () => {
    (cancelDay as jest.Mock).mockResolvedValue({ status: "forfeited", paidCount: 1, refundCount: 1 });
    const res = await POST(postReq({ gameCategory: "mahjong", seasonId: "s1", eventDate: "2026-07-18" }));
    expect(res.status).toBe(200);
    expect(cancelDay).toHaveBeenCalledWith("s1", "2026-07-18", "admin:admin@test.com");
  });

  test("started/finished/closed は 409、already は 200(already)", async () => {
    (cancelDartsDay as jest.Mock).mockResolvedValueOnce({ status: "started" });
    expect((await POST(postReq({ gameCategory: "darts", seasonId: "s1", eventDate: "2026-07-16" }))).status).toBe(409);
    (cancelDartsDay as jest.Mock).mockResolvedValueOnce({ status: "finished" });
    expect((await POST(postReq({ gameCategory: "darts", seasonId: "s1", eventDate: "2026-07-16" }))).status).toBe(409);
    (cancelDay as jest.Mock).mockResolvedValueOnce({ status: "closed" });
    expect((await POST(postReq({ gameCategory: "mahjong", seasonId: "s1", eventDate: "2026-07-18" }))).status).toBe(409);
    (cancelDartsDay as jest.Mock).mockResolvedValueOnce({ status: "already" });
    const res = await POST(postReq({ gameCategory: "darts", seasonId: "s1", eventDate: "2026-07-16" }));
    expect(res.status).toBe(200);
    expect((await res.json()).already).toBe(true);
  });

  test("不正な入力は 400（cancel は呼ばれない）", async () => {
    expect((await POST(postReq({ gameCategory: "chess", seasonId: "s1", eventDate: "2026-07-16" }))).status).toBe(400);
    expect((await POST(postReq({ gameCategory: "darts", seasonId: "", eventDate: "2026-07-16" }))).status).toBe(400);
    expect((await POST(postReq({ gameCategory: "darts", seasonId: "s1", eventDate: "2026-13-40" }))).status).toBe(400);
    expect(cancelDartsDay).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/games/day（参加者・休催状態）", () => {
  test("参加者を導出し件数(total/paid/refundable)と closed を返す", async () => {
    // paid(実決済) / staff-paid(txなし=返金対象外) / reserved
    db.__seed("dartsEntries", "s1_2026-07-16_a", { seasonId: "s1", eventDate: "2026-07-16", displayName: "A", status: "paid", paymentStatus: "paid", paymentTransactionId: "ord-a" });
    db.__seed("dartsEntries", "s1_2026-07-16_b", { seasonId: "s1", eventDate: "2026-07-16", displayName: "B", status: "paid", paymentStatus: "paid" });
    db.__seed("dartsEntries", "s1_2026-07-16_c", { seasonId: "s1", eventDate: "2026-07-16", displayName: "C", status: "reserved" });
    const res = await GET(getReq("gameCategory=darts&seasonId=s1&eventDate=2026-07-16"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.closed).toBe(false);
    expect(body.counts).toEqual({ total: 3, paid: 2, refundable: 1 });
    expect(body.participants.map((p: { displayName: string }) => p.displayName)).toEqual(["A", "B", "C"]);
  });

  test("cancelledDates があれば closed=true", async () => {
    db.__seed("dartsCancelledDates", "2026-07-16", { seasonId: "s1", eventDate: "2026-07-16" });
    const res = await GET(getReq("gameCategory=darts&seasonId=s1&eventDate=2026-07-16"));
    expect((await res.json()).closed).toBe(true);
  });

  test("list=1 でシーズンの休催日一覧を返す", async () => {
    db.__seed("billiardsCancelledDates", "2026-07-18", { seasonId: "s1", eventDate: "2026-07-18" });
    db.__seed("billiardsCancelledDates", "2026-07-25", { seasonId: "s1", eventDate: "2026-07-25" });
    db.__seed("billiardsCancelledDates", "2026-08-01", { seasonId: "other", eventDate: "2026-08-01" });
    const res = await GET(getReq("gameCategory=billiards&seasonId=s1&list=1"));
    const body = await res.json();
    expect(body.closedDates.sort()).toEqual(["2026-07-18", "2026-07-25"]);
  });

  test("eventDate 無し（list でもない）は 400", async () => {
    expect((await GET(getReq("gameCategory=darts&seasonId=s1"))).status).toBe(400);
  });
});
