/**
 * 単体テスト: src/lib/billing.ts（請求管理の正規化・集計）
 * TZ=UTC で実行（package.json）＝本番 Vercel と同じ条件。JST 前提の日付処理を固定する。
 */
import {
  billingDate,
  gameEntryToBilling,
  jstDateFromIso,
  jstDayEndIso,
  jstDayStartIso,
  monthRange,
  reservationToBilling,
  summarizeBilling,
  yearRange,
  type BillingRecord,
} from "@/lib/billing";

const NOW = "2026-08-17T00:00:00.000Z";

describe("日付ユーティリティ（JST 固定）", () => {
  it("UTC の ISO を JST の暦日に直す（日付境界をまたぐ）", () => {
    // 8/31 15:00Z = 9/1 0:00 JST → 9月に計上される
    expect(jstDateFromIso("2026-08-31T15:00:00.000Z")).toBe("2026-09-01");
    expect(jstDateFromIso("2026-08-31T14:59:59.000Z")).toBe("2026-08-31");
  });

  it("JST の1日ぶんの範囲を UTC ISO で作る", () => {
    expect(jstDayStartIso("2026-08-01")).toBe("2026-07-31T15:00:00.000Z");
    expect(jstDayEndIso("2026-08-31")).toBe("2026-08-31T14:59:59.999Z");
  });

  it("月末を正しく求める（うるう年・30日月）", () => {
    expect(monthRange("2026-08")).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(monthRange("2026-09")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(monthRange("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(yearRange("2026")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
});

describe("gameEntryToBilling", () => {
  const base = {
    seasonId: "s1",
    eventDate: "2026-08-08",
    lineUserId: "U1",
    displayName: "山田",
  };

  it("支払い済みは入金済（金額は保存値を優先）", () => {
    const r = gameEntryToBilling(
      "mahjong",
      "e1",
      { ...base, status: "paid", paymentStatus: "paid", paymentAmount: 3000, paidAt: "2026-08-01T02:00:00.000Z", paymentTransactionId: "ORDER1" },
      3000,
      NOW,
    );
    expect(r.status).toBe("paid");
    expect(r.amount).toBe(3000);
    expect(r.orderId).toBe("ORDER1");
  });

  it("⚠️ staff の免除エントリー（status=paid だが決済フィールドが無い）は金額0の免除にする", () => {
    // ここを入金済として数えると売上が水増しされる。
    const r = gameEntryToBilling("darts", "e2", { ...base, status: "paid" }, 1000, NOW);
    expect(r.status).toBe("exempt");
    expect(r.amount).toBe(0);
  });

  it("決済を開始していない未払い（status=reserved）は未入金として参加費を計上する", () => {
    const r = gameEntryToBilling("darts", "e3", { ...base, status: "reserved" }, 1000, NOW);
    expect(r.status).toBe("unpaid");
    expect(r.amount).toBe(1000);
    expect(r.expired).toBe(false);
  });

  it("仮押さえTTLを過ぎた未払いは失効フラグが立つ", () => {
    const r = gameEntryToBilling(
      "poker",
      "e4",
      { ...base, status: "reserved", paymentStatus: "pending", paymentTransactionId: "O2", pendingExpiresAt: "2026-08-16T00:00:00.000Z" },
      2000,
      NOW,
    );
    expect(r.status).toBe("unpaid");
    expect(r.expired).toBe(true);
  });

  it("キャンセル依頼は返金対応待ち・流会は理由が付く／返金済は返金済", () => {
    const req = gameEntryToBilling("mahjong", "e5", { ...base, status: "cancelRequested", paymentAmount: 3000, paidAt: "2026-08-01T02:00:00.000Z" }, 3000, NOW);
    expect(req.status).toBe("refundRequested");

    const forfeit = gameEntryToBilling("mahjong", "e6", { ...base, status: "cancelRequested", cancelReason: "forfeit", paymentAmount: 3000 }, 3000, NOW);
    expect(forfeit.note).toContain("流会");

    const done = gameEntryToBilling("mahjong", "e7", { ...base, status: "refunded", paymentAmount: 3000 }, 3000, NOW);
    expect(done.status).toBe("refunded");
  });

  it("却下されたキャンセル依頼は入金済のまま（お金は手元に残る）", () => {
    const r = gameEntryToBilling("billiards", "e8", { ...base, status: "cancelRejected", paymentAmount: 1500, paidAt: "2026-08-01T02:00:00.000Z" }, 1500, NOW);
    expect(r.status).toBe("paid");
  });

  it("旧データ（status 未設定・paymentStatus のみ）でも判定できる", () => {
    const r = gameEntryToBilling("mahjong", "e9", { ...base, paymentStatus: "paid", paymentAmount: 3000 }, 3000, NOW);
    expect(r.status).toBe("paid");
  });
});

describe("reservationToBilling", () => {
  const base = {
    facilityName: "トレーラー",
    lineUserId: "U9",
    date: "2026-08-20",
    createdAt: "2026-08-01T01:00:00.000Z",
  };

  it("決済額のない予約（無料施設）は請求として扱わない", () => {
    expect(reservationToBilling("r0", { ...base, status: "confirmed" }, "佐藤", NOW)).toBeNull();
  });

  it("決済完了は入金済（paidAt が無い旧データは updatedAt→createdAt で代用）", () => {
    const withPaidAt = reservationToBilling(
      "r1",
      { ...base, status: "confirmed", paymentStatus: "completed", paymentAmount: 20000, paidAt: "2026-08-01T01:05:00.000Z", paymentId: "P1", paymentTransactionId: "O1" },
      "佐藤",
      NOW,
    );
    expect(withPaidAt?.status).toBe("paid");
    expect(withPaidAt?.paidAt).toBe("2026-08-01T01:05:00.000Z");
    expect(withPaidAt?.paymentId).toBe("P1");

    const legacy = reservationToBilling(
      "r2",
      { ...base, status: "confirmed", paymentStatus: "completed", paymentAmount: 20000, updatedAt: "2026-08-01T01:06:00.000Z" },
      "佐藤",
      NOW,
    );
    expect(legacy?.paidAt).toBe("2026-08-01T01:06:00.000Z");
  });

  it("⚠️ 入金済のまま取消された予約は返金対応待ちにする（見落とすと返金漏れになる）", () => {
    // キャンセルしても paymentStatus は completed のまま残る（admin DELETE の実装）。
    const r = reservationToBilling(
      "r3",
      { ...base, status: "cancelled", paymentStatus: "completed", paymentAmount: 20000 },
      "佐藤",
      NOW,
    );
    expect(r?.status).toBe("refundRequested");
    expect(r?.note).toContain("返金");
  });

  it("未入金の仮押さえは未入金（TTL 超過は失効）", () => {
    const alive = reservationToBilling(
      "r4",
      { ...base, status: "pending_payment", paymentAmount: 20000, pendingExpiresAt: "2026-08-18T00:00:00.000Z" },
      "佐藤",
      NOW,
    );
    expect(alive?.status).toBe("unpaid");
    expect(alive?.expired).toBe(false);

    const dead = reservationToBilling(
      "r5",
      { ...base, status: "pending_payment", paymentAmount: 20000, pendingExpiresAt: "2026-08-16T23:00:00.000Z" },
      "佐藤",
      NOW,
    );
    expect(dead?.expired).toBe(true);
  });

  it("返金済は返金済のまま", () => {
    const r = reservationToBilling(
      "r6",
      { ...base, status: "cancelled", paymentStatus: "refunded", paymentAmount: 20000 },
      "佐藤",
      NOW,
    );
    expect(r?.status).toBe("refunded");
  });
});

describe("summarizeBilling", () => {
  const rec = (over: Partial<BillingRecord>): BillingRecord => ({
    id: "x",
    source: "mahjong",
    refId: "x",
    itemName: "麻雀 参加費",
    seasonId: null,
    seasonName: null,
    useDate: "2026-08-08",
    paidAt: null,
    amount: 3000,
    status: "paid",
    lineUserId: "U",
    displayName: "名",
    orderId: null,
    paymentId: null,
    expired: false,
    note: null,
    ...over,
  });

  it("状態ごとに金額を二重計上せず振り分ける", () => {
    const s = summarizeBilling([
      rec({ id: "1", status: "paid" }),
      rec({ id: "2", status: "refundRequested" }),
      rec({ id: "3", status: "refunded" }),
      rec({ id: "4", status: "unpaid" }),
      rec({ id: "5", status: "unpaid", expired: true }),
      rec({ id: "6", status: "cancelled" }),
      rec({ id: "7", status: "exempt", amount: 0 }),
    ]);
    expect(s.count).toBe(7);
    // 手元にあるのは paid + refundRequested の 2 件。
    expect(s.receivedAmount).toBe(6000);
    expect(s.refundPendingAmount).toBe(3000); // receivedAmount の内数
    expect(s.refundedAmount).toBe(3000);
    expect(s.unpaidAmount).toBe(3000); // 失効ぶんは含めない
    expect(s.expiredAmount).toBe(3000);
  });

  it("種別ごとの内訳を出す", () => {
    const s = summarizeBilling([
      rec({ id: "1", source: "reservation", amount: 20000 }),
      rec({ id: "2", source: "mahjong" }),
      rec({ id: "3", source: "mahjong", status: "unpaid" }),
    ]);
    expect(s.bySource.map((b) => b.source)).toEqual(["reservation", "mahjong"]);
    expect(s.bySource[0].totals.receivedAmount).toBe(20000);
    expect(s.bySource[1].totals).toMatchObject({ count: 2, receivedAmount: 3000, unpaidAmount: 3000 });
  });
});

describe("billingDate（集計基準）", () => {
  const r: BillingRecord = {
    id: "1", source: "reservation", refId: "1", itemName: "トレーラー", seasonId: null, seasonName: null,
    useDate: "2026-09-05", paidAt: "2026-08-31T15:30:00.000Z", amount: 20000, status: "paid",
    lineUserId: "U", displayName: "名", orderId: null, paymentId: null, expired: false, note: null,
  };

  it("利用日基準は利用日、入金日基準は JST の入金日", () => {
    expect(billingDate(r, "use")).toBe("2026-09-05");
    // 8/31 15:30Z = 9/1 0:30 JST（TZ=UTC の本番で 8 月に落ちないこと）
    expect(billingDate(r, "paid")).toBe("2026-09-01");
  });

  it("入金日基準でも未入金は利用日で扱う（一覧から消えない）", () => {
    expect(billingDate({ ...r, paidAt: null, status: "unpaid" }, "paid")).toBe("2026-09-05");
  });
});
