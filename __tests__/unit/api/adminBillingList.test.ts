/**
 * 単体テスト: GET /api/admin/billing（請求一覧の組み立て）
 *
 * 主眼は「Square を開くURL（squareUrl）が出るか」。
 * Square 管理画面は注文ID(orderId)で検索できないため、決済ID or レシートURL が無いと一覧から辿れない。
 * ⚠️ 書く側（verify / complete）と読む側（この一覧）のフィールドが食い違うと、
 *    照合したのにリンクが出ない／既にある決済IDを使えない、が起きる。ここで固定する。
 */
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/adminAuth", () => ({ checkAdminAuth: jest.fn().mockResolvedValue("admin@example.com") }));
jest.mock("@/lib/facilitySecrets", () => ({ getFacilitySquareStatusMap: jest.fn().mockResolvedValue({}) }));
// 一覧APIは Square を叩かないが、gameEntryPayment 経由で SDK が読み込まれるのでモックで遮断する。
jest.mock("@/lib/square", () => ({}));

import { getDb } from "@/lib/firebaseAdmin";
import { getFacilitySquareStatusMap } from "@/lib/facilitySecrets";
import { GET } from "@/app/api/admin/billing/route";
import type { NextRequest } from "next/server";
import type { BillingRecord } from "@/lib/billing";

type Data = Record<string, unknown>;
type Store = Record<string, Record<string, Data>>;

/** where(等値/範囲) と getAll を最小限サポートする in-memory Firestore モック。 */
function makeDb(store: Store) {
  const col = (n: string) => store[n] ?? {};
  const query = (n: string, filters: { f: string; op: string; v: string }[]) => ({
    where: (f: string, op: string, v: string) => query(n, [...filters, { f, op, v }]),
    get: async () => ({
      docs: Object.entries(col(n))
        .filter(([, d]) =>
          filters.every(({ f, op, v }) => {
            const val = d[f];
            if (typeof val !== "string") return false;
            if (op === "==") return val === v;
            if (op === ">=") return val >= v;
            if (op === "<=") return val <= v;
            return true;
          }),
        )
        .map(([id, d]) => ({ id, data: () => d })),
    }),
  });
  return {
    collection: (n: string) => ({
      ...query(n, []),
      doc: (id: string) => ({
        __c: n,
        id,
        get: async () => ({ exists: id in col(n), id, data: () => col(n)[id] }),
      }),
    }),
    getAll: async (...refs: { __c: string; id: string }[]) =>
      refs.map((r) => ({
        exists: r.id in col(r.__c),
        id: r.id,
        data: () => col(r.__c)[r.id],
      })),
  };
}

const req = (qs: string) =>
  ({ nextUrl: new URL(`http://localhost/api/admin/billing?${qs}`) }) as unknown as NextRequest;

async function fetchRecords(qs: string): Promise<BillingRecord[]> {
  const res = await GET(req(qs));
  expect(res.status).toBe(200);
  return (await res.json()).records as BillingRecord[];
}

const OLD_ENV = process.env;
beforeEach(() => {
  jest.clearAllMocks();
  (getFacilitySquareStatusMap as jest.Mock).mockResolvedValue({});
  process.env = { ...OLD_ENV, SQUARE_ENVIRONMENT: "production" };
});
afterAll(() => {
  process.env = OLD_ENV;
});

describe("GET /api/admin/billing — Square を開くURL", () => {
  it("予約: 決済時に保存した paymentId から取引URLを出す", async () => {
    (getDb as jest.Mock).mockReturnValue(
      makeDb({
        reservations: {
          r1: {
            facilityId: "trailer",
            facilityName: "トレーラー",
            lineUserId: "U1",
            date: "2026-08-20",
            status: "confirmed",
            paymentStatus: "completed",
            paymentAmount: 20000,
            paymentId: "PAY1",
            paymentTransactionId: "ORDER1",
            createdAt: "2026-08-01T01:00:00.000Z",
          },
        },
      }),
    );

    const [rec] = await fetchRecords("month=2026-08&source=reservation");
    expect(rec.squareUrl).toBe("https://squareup.com/dashboard/sales/transactions/PAY1");
  });

  it("⚠️ 予約: 照合で保存した squarePaymentId でもリンクが出る（旧データは paymentId が無い）", async () => {
    // verify API は squarePaymentId に書く。一覧が paymentId しか見ないと、
    // 「照合したのにリンクが出ない」になる。
    (getDb as jest.Mock).mockReturnValue(
      makeDb({
        reservations: {
          r2: {
            facilityId: "trailer",
            facilityName: "トレーラー",
            lineUserId: "U1",
            date: "2026-08-20",
            status: "confirmed",
            paymentStatus: "completed",
            paymentAmount: 20000,
            paymentTransactionId: "ORDER2",
            squarePaymentId: "PAY2",
            createdAt: "2026-08-01T01:00:00.000Z",
          },
        },
      }),
    );

    const [rec] = await fetchRecords("month=2026-08&source=reservation");
    expect(rec.paymentId).toBe("PAY2");
    expect(rec.squareUrl).toBe("https://squareup.com/dashboard/sales/transactions/PAY2");
  });

  it("予約: レシートURLがあればそれを優先する", async () => {
    (getDb as jest.Mock).mockReturnValue(
      makeDb({
        reservations: {
          r3: {
            facilityId: "trailer",
            facilityName: "トレーラー",
            lineUserId: "U1",
            date: "2026-08-20",
            status: "confirmed",
            paymentStatus: "completed",
            paymentAmount: 20000,
            paymentId: "PAY3",
            paymentTransactionId: "ORDER3",
            squareReceiptUrl: "https://squareup.com/receipt/xyz",
            createdAt: "2026-08-01T01:00:00.000Z",
          },
        },
      }),
    );

    const [rec] = await fetchRecords("month=2026-08&source=reservation");
    expect(rec.squareUrl).toBe("https://squareup.com/receipt/xyz");
  });

  it("⚠️ 施設がサンドボックス設定ならサンドボックスのドメインで開く", async () => {
    (getFacilitySquareStatusMap as jest.Mock).mockResolvedValue({
      trailer: { configured: true, environment: "sandbox" },
    });
    (getDb as jest.Mock).mockReturnValue(
      makeDb({
        reservations: {
          r4: {
            facilityId: "trailer",
            facilityName: "トレーラー",
            lineUserId: "U1",
            date: "2026-08-20",
            status: "confirmed",
            paymentStatus: "completed",
            paymentAmount: 20000,
            paymentId: "PAY4",
            paymentTransactionId: "ORDER4",
            createdAt: "2026-08-01T01:00:00.000Z",
          },
        },
      }),
    );

    const [rec] = await fetchRecords("month=2026-08&source=reservation");
    expect(rec.squareUrl).toBe("https://squareupsandbox.com/dashboard/sales/transactions/PAY4");
  });

  it("⚠️ 参加費: 決済確定時に squareOrders へ書かれている paymentId を使ってリンクを出す", async () => {
    // 参加費エントリーは paymentId を持たないが、complete が squareOrders/{orderId} に書いている。
    // これを使わないと、入金済なのに1件ずつ Square を叩くまでリンクが出ない。
    (getDb as jest.Mock).mockReturnValue(
      makeDb({
        mahjongEntries: {
          e1: {
            seasonId: "s1",
            eventDate: "2026-08-08",
            lineUserId: "U2",
            displayName: "山田",
            status: "paid",
            paymentStatus: "paid",
            paymentAmount: 3000,
            paymentTransactionId: "ORDER5",
            paidAt: "2026-08-01T02:00:00.000Z",
          },
        },
        squareOrders: {
          ORDER5: { entryId: "e1", paymentId: "PAY5", lineUserId: "U2" },
        },
        seasons: { s1: { name: "2026 S1", gameCategory: "mahjong" } },
      }),
    );

    const [rec] = await fetchRecords("month=2026-08&source=mahjong");
    expect(rec.paymentId).toBe("PAY5");
    expect(rec.squareUrl).toBe("https://squareup.com/dashboard/sales/transactions/PAY5");
  });

  it("参加費: 種目ごとの Square 環境（SQUARE_{GAME}_ENVIRONMENT）を優先する", async () => {
    process.env.SQUARE_DARTS_ENVIRONMENT = "sandbox";
    (getDb as jest.Mock).mockReturnValue(
      makeDb({
        dartsEntries: {
          e2: {
            seasonId: "s2",
            eventDate: "2026-08-08",
            lineUserId: "U3",
            displayName: "鈴木",
            status: "paid",
            paymentStatus: "paid",
            paymentAmount: 1000,
            paymentTransactionId: "ORDER6",
            squarePaymentId: "PAY6",
            paidAt: "2026-08-01T02:00:00.000Z",
          },
        },
        seasons: { s2: { name: "2026 S1", gameCategory: "darts" } },
      }),
    );

    const [rec] = await fetchRecords("month=2026-08&source=darts");
    expect(rec.squareUrl).toBe("https://squareupsandbox.com/dashboard/sales/transactions/PAY6");
  });

  it("回帰: 未入金でも squareOrders に返金フラグがあれば要返金として出す", async () => {
    (getDb as jest.Mock).mockReturnValue(
      makeDb({
        pokerEntries: {
          e3: {
            seasonId: "s3",
            eventDate: "2026-08-08",
            lineUserId: "U4",
            displayName: "田中",
            status: "reserved",
            paymentStatus: "pending",
            paymentAmount: 2000,
            paymentTransactionId: "ORDER7",
            pendingExpiresAt: "2026-08-09T00:00:00.000Z",
          },
        },
        squareOrders: { ORDER7: { entryId: "e3", expiredRefund: true } },
        seasons: { s3: { name: "2026 S1", gameCategory: "poker" } },
      }),
    );

    const [rec] = await fetchRecords("month=2026-08&source=poker");
    expect(rec.refundNeeded).toBe(true);
    expect(rec.status).toBe("unpaid");
  });
});
