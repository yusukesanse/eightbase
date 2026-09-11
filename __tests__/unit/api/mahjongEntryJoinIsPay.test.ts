/**
 * 単体テスト: 麻雀「参加する＝お支払いへ進む」（WP2）。
 *
 * 固定する仕様:
 *  - 会員/ゲストの POST /api/mahjong/entries は Square 決済リンクを発行し、
 *    entry を `pending`（15分の仮押さえ）で作って `paymentUrl` を返す
 *  - staff は従来どおり `paid`（参加確定）で、決済リンクは発行しない
 *  - **リンク発行に失敗したら entry を作らない**（席だけ押さえて支払えない状態を残さない）
 *  - 席（定員8名・月1回）を数えるのは `isActiveMahjongEntry` が true のものだけ。
 *    2026-09-11: **未払い（期限切れの仮押さえ・旧 `reserved`）も席を持つ**（WP2 の「期限切れは席を返す」を撤回。
 *    払わない人で満員になり得るリスクは表示の分かりやすさを優先して受け入れた）
 *  - 期限内の仮押さえがある状態で再 POST しても **新しい注文を切らず**同じ paymentUrl を返す
 *  - 期限切れの仮押さえの再 POST は **古い URL を返さず**新しいリンクを発行し直す（古い注文で払うと 410→返金になる）
 *  - 本番でも `pending` の参加は取り消せる（月ロックも解放される）
 */
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/auth", () => ({
  requireGameUser: jest.fn(),
  requireGameUserWithRole: jest.fn(),
}));
jest.mock("@/lib/mahjong", () => ({ getActiveSeason: jest.fn() }));
jest.mock("@/lib/mahjongDay", () => ({ getDayState: jest.fn(), isEntryClosed: () => false }));
jest.mock("@/lib/mahjongSchedule", () => ({ listMahjongScheduleDates: jest.fn() }));
jest.mock("@/lib/gameSchedule", () => ({ isScheduleDateBlockedInTx: async () => false }));
jest.mock("@/lib/square", () => ({
  createReservationPaymentLink: jest.fn(),
  squareErrorDetail: (e: unknown) => String(e),
}));
jest.mock("@/lib/liffUrl", () => ({ liffUrl: (p: string) => `https://liff.example${p}` }));
// 本番相当（isProduction=true）で確認する。DELETE の DEV-ONLY 分岐に逃げないため。
jest.mock("@/lib/env", () => ({ isDevLoginEnabled: () => false, isProduction: () => true }));

jest.mock("@/lib/date", () => ({
  ...jest.requireActual("@/lib/date"),
  todayJst: () => "2026-07-05",
}));

import { isUnpaidMahjongEntry } from "@/lib/mahjongEntryStatus";
import { POST as PAY } from "@/app/api/mahjong/entries/pay/route";

import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser, requireGameUserWithRole } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { listMahjongScheduleDates } from "@/lib/mahjongSchedule";
import { createReservationPaymentLink } from "@/lib/square";
import { isActiveMahjongEntry } from "@/lib/mahjongEntryStatus";
import { buildMahjongEntryId } from "@/lib/mahjongEntryValidation";
import { GET, POST, DELETE } from "@/app/api/mahjong/entries/route";
import type { NextRequest } from "next/server";

type Data = Record<string, unknown>;

const SEASON = "S1";
const USER = "U_user";
const DATE_A = "2026-07-11";
const DATE_B = "2026-07-18";
const ENTRY_A = buildMahjongEntryId(SEASON, DATE_A, USER);

/** トランザクション（tx.get で docRef と where クエリの両方を扱う）に対応する簡易 Firestore。 */
function makeDb() {
  const store = new Map<string, Map<string, Data>>();
  const col = (n: string) => {
    if (!store.has(n)) store.set(n, new Map());
    return store.get(n)!;
  };
  const docRef = (c: string, id: string) => ({
    __kind: "doc" as const,
    __c: c,
    id,
    get: async () => ({ exists: col(c).has(id), id, data: () => col(c).get(id) }),
    set: async (d: Data, opt?: { merge?: boolean }) => {
      col(c).set(id, opt?.merge ? { ...(col(c).get(id) ?? {}), ...d } : { ...d });
    },
    delete: async () => {
      col(c).delete(id);
    },
  });
  const query = (c: string, conds: [string, unknown][]) => ({
    __kind: "query" as const,
    __c: c,
    __conds: conds,
    where: (f: string, _op: string, v: unknown) => query(c, [...conds, [f, v]]),
    get: async () => {
      const docs = [...col(c).entries()]
        .filter(([, v]) => conds.every(([f, val]) => v[f] === val))
        .map(([id, v]) => ({ id, data: () => v }));
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  });
  type Ref = ReturnType<typeof docRef> | ReturnType<typeof query>;
  const db = {
    collection: (c: string) => ({
      doc: (id: string) => docRef(c, id),
      where: (f: string, _op: string, v: unknown) => query(c, [[f, v]]),
    }),
    runTransaction: async (fn: (tx: unknown) => Promise<void>) => {
      const writes: [string, string, Data, boolean][] = [];
      const tx = {
        get: async (ref: Ref) => ref.get(),
        set: (ref: ReturnType<typeof docRef>, d: Data, opt?: { merge?: boolean }) => {
          writes.push([ref.__c, ref.id, d, !!opt?.merge]);
        },
      };
      await fn(tx);
      // 例外が出たら writes は捨てる＝ロールバック相当。
      writes.forEach(([c, id, d, merge]) => {
        col(c).set(id, merge ? { ...(col(c).get(id) ?? {}), ...d } : { ...d });
      });
    },
    __set: (c: string, id: string, d: Data) => col(c).set(id, d),
    __get: (c: string, id: string) => col(c).get(id),
    __size: (c: string) => col(c).size,
  };
  return db;
}

let db: ReturnType<typeof makeDb>;

function req(body?: unknown, search: Record<string, string> = {}): NextRequest {
  return {
    json: async () => body,
    headers: new Headers({ origin: "https://app.example" }),
    nextUrl: { origin: "https://app.example", searchParams: new URLSearchParams(search) },
  } as unknown as NextRequest;
}

function setUser(role: "member" | "guest" | "staff") {
  (requireGameUserWithRole as jest.Mock).mockResolvedValue({
    lineUserId: USER,
    role,
    monthlyEntryExempt: false,
  });
  (requireGameUser as jest.Mock).mockResolvedValue(USER);
}

/** 期限内 / 期限切れの仮押さえ entry を作る。 */
function pendingEntry(eventDate: string, lineUserId: string, minutesFromNow: number): Data {
  return {
    seasonId: SEASON,
    eventDate,
    lineUserId,
    displayName: lineUserId,
    enteredAt: "2026-07-01T00:00:00.000Z",
    status: "reserved",
    paymentStatus: "pending",
    paymentTransactionId: `order-${lineUserId}`,
    pendingExpiresAt: new Date(Date.now() + minutesFromNow * 60_000).toISOString(),
  };
}

beforeEach(() => {
  db = makeDb();
  (getDb as jest.Mock).mockReturnValue(db);
  (getActiveSeason as jest.Mock).mockResolvedValue({ seasonId: SEASON });
  (listMahjongScheduleDates as jest.Mock).mockResolvedValue(new Set([DATE_A, DATE_B]));
  (createReservationPaymentLink as jest.Mock).mockReset();
  (createReservationPaymentLink as jest.Mock).mockResolvedValue({
    url: "https://square.link/pay-1",
    orderId: "ORDER1",
  });
  db.__set("users", USER, { displayName: "テスト太郎", pictureUrl: "" });
  setUser("member");
});

describe("参加する＝お支払いへ進む（POST /api/mahjong/entries）", () => {
  test("会員: 201 で paymentUrl を返し、entry は pending（期限・注文ID付き）", async () => {
    const res = await POST(req({ eventDate: DATE_A }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.paymentUrl).toBe("https://square.link/pay-1");

    const saved = db.__get("mahjongEntries", ENTRY_A)!;
    expect(saved.status).toBe("reserved");
    expect(saved.paymentStatus).toBe("pending");
    expect(saved.paymentTransactionId).toBe("ORDER1");
    expect(saved.paymentAmount).toBe(3000);
    expect(saved.paymentUrl).toBe("https://square.link/pay-1");
    expect(typeof saved.pendingExpiresAt).toBe("string");
    expect(new Date(saved.pendingExpiresAt as string).getTime()).toBeGreaterThan(Date.now());
    // 戻り先は全ロールが入れる /games（会員専用ルートにしない）。
    const arg = (createReservationPaymentLink as jest.Mock).mock.calls[0][0];
    expect(arg.redirectUrl).toContain(`/games?mjpay=${ENTRY_A}`);
    expect(arg.amount).toBe(3000);
  });

  test("staff: 参加確定（paid）で決済リンクを発行しない", async () => {
    setUser("staff");
    const res = await POST(req({ eventDate: DATE_A }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.paymentUrl).toBeUndefined();
    expect(createReservationPaymentLink).not.toHaveBeenCalled();

    const saved = db.__get("mahjongEntries", ENTRY_A)!;
    expect(saved.status).toBe("paid");
    expect(saved.paymentStatus).toBeUndefined();
  });

  test("決済リンク生成に失敗したら 502 で entry を作らない（席だけ押さえない）", async () => {
    (createReservationPaymentLink as jest.Mock).mockRejectedValue(new Error("square down"));
    const res = await POST(req({ eventDate: DATE_A }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("PAYMENT_LINK_FAILED");
    expect(db.__size("mahjongEntries")).toBe(0);
    // 月ロックも消費しない（次に参加し直せる）。
    expect(db.__size("mahjongMonthlyLocks")).toBe(0);
  });

  test("仮押さえは期限切れでも席を持つ＝8件で満員（期限内8件も満員）", async () => {
    for (let i = 0; i < 8; i++) {
      db.__set("mahjongEntries", `expired-${i}`, pendingEntry(DATE_A, `U_o${i}`, -1));
    }
    const expiredRes = await POST(req({ eventDate: DATE_A }));
    expect(expiredRes.status).toBe(409);
    expect((await expiredRes.json()).full).toBe(true);

    db = makeDb();
    (getDb as jest.Mock).mockReturnValue(db);
    db.__set("users", USER, { displayName: "テスト太郎" });
    for (let i = 0; i < 8; i++) {
      db.__set("mahjongEntries", `live-${i}`, pendingEntry(DATE_A, `U_o${i}`, 10));
    }
    const res = await POST(req({ eventDate: DATE_A }));
    expect(res.status).toBe(409);
    expect((await res.json()).full).toBe(true);
  });

  test("期限切れ pending の再 POST は古い URL を返さず、新しいリンクを発行し直して enteredAt を維持する", async () => {
    db.__set("mahjongEntries", ENTRY_A, {
      ...pendingEntry(DATE_A, USER, -1),
      paymentUrl: "https://square.link/old",
    });
    (createReservationPaymentLink as jest.Mock).mockResolvedValue({
      url: "https://square.link/pay-2",
      orderId: "ORDER2",
    });
    const res = await POST(req({ eventDate: DATE_A }));
    expect(res.status).toBe(201);
    expect((await res.json()).paymentUrl).toBe("https://square.link/pay-2");
    const saved = db.__get("mahjongEntries", ENTRY_A)!;
    expect(saved.paymentTransactionId).toBe("ORDER2");
    expect(saved.paymentUrl).toBe("https://square.link/pay-2");
    expect(new Date(saved.pendingExpiresAt as string).getTime()).toBeGreaterThan(Date.now());
    expect(saved.enteredAt).toBe("2026-07-01T00:00:00.000Z");
  });

  test("期限内 pending の再 POST は同じ paymentUrl（注文を二重に切らない）", async () => {
    const first = await (await POST(req({ eventDate: DATE_A }))).json();
    (createReservationPaymentLink as jest.Mock).mockResolvedValue({
      url: "https://square.link/pay-2",
      orderId: "ORDER2",
    });

    const second = await POST(req({ eventDate: DATE_A }));
    expect(second.status).toBe(201);
    expect((await second.json()).paymentUrl).toBe(first.paymentUrl);
    expect(createReservationPaymentLink).toHaveBeenCalledTimes(1);
    expect(db.__get("mahjongEntries", ENTRY_A)!.paymentTransactionId).toBe("ORDER1");
  });

  test("支払い済み（paid）の再 POST は従来どおり 201・paymentUrl なし", async () => {
    db.__set("mahjongEntries", ENTRY_A, {
      seasonId: SEASON,
      eventDate: DATE_A,
      lineUserId: USER,
      displayName: "テスト太郎",
      enteredAt: "2026-07-01T00:00:00.000Z",
      status: "paid",
      paymentStatus: "paid",
    });
    const res = await POST(req({ eventDate: DATE_A }));
    expect(res.status).toBe(201);
    expect((await res.json()).paymentUrl).toBeUndefined();
    expect(createReservationPaymentLink).not.toHaveBeenCalled();
  });

  test("期限切れの自分の仮押さえ（未払い）も、当月の別日の参加を塞ぐ（席を持つため）", async () => {
    db.__set("mahjongEntries", ENTRY_A, pendingEntry(DATE_A, USER, -1));
    db.__set("mahjongMonthlyLocks", `${SEASON}_${USER}_2026-07`, {
      seasonId: SEASON,
      lineUserId: USER,
      ym: "2026-07",
      eventDate: DATE_A,
    });
    const res = await POST(req({ eventDate: DATE_B }));
    expect(res.status).toBe(409);
    expect((await res.json()).monthlyLimit).toBe(true);
  });

  test("期限内の自分の仮押さえは、当月の別日の参加を塞ぐ（従来どおり 409）", async () => {
    db.__set("mahjongEntries", ENTRY_A, pendingEntry(DATE_A, USER, 10));
    db.__set("mahjongMonthlyLocks", `${SEASON}_${USER}_2026-07`, {
      seasonId: SEASON,
      lineUserId: USER,
      ym: "2026-07",
      eventDate: DATE_A,
    });
    const res = await POST(req({ eventDate: DATE_B }));
    expect(res.status).toBe(409);
    expect((await res.json()).monthlyLimit).toBe(true);
  });
});

describe("GET /api/mahjong/entries", () => {
  test("?mine=1 は期限切れの仮押さえを unpaid:true で返し、期限内は unpaid なしで返す", async () => {
    db.__set("mahjongEntries", ENTRY_A, pendingEntry(DATE_A, USER, -1));
    db.__set(
      "mahjongEntries",
      buildMahjongEntryId(SEASON, DATE_B, USER),
      pendingEntry(DATE_B, USER, 10)
    );
    const body = await (await GET(req(undefined, { mine: "1" }))).json();
    expect(body.entries).toHaveLength(2);
    const byDate = Object.fromEntries(body.entries.map((e: { eventDate: string }) => [e.eventDate, e]));
    expect(byDate[DATE_A]).toMatchObject({ paymentStatus: "pending", unpaid: true });
    expect(byDate[DATE_B]).toMatchObject({ paymentStatus: "pending", paymentUrl: null });
    expect(byDate[DATE_B].unpaid).toBeUndefined();
    expect(typeof byDate[DATE_B].pendingExpiresAt).toBe("string");
    expect(byDate[DATE_B].entryId).toBe(buildMahjongEntryId(SEASON, DATE_B, USER));
  });

  test("開催日の一覧は期限切れも数え、期限切れは unpaid・支払い済みは paid と出す", async () => {
    db.__set("mahjongEntries", "e-expired", pendingEntry(DATE_A, "U_x", -1));
    db.__set("mahjongEntries", "e-pending", pendingEntry(DATE_A, "U_y", 10));
    db.__set("mahjongEntries", "e-paid", {
      seasonId: SEASON,
      eventDate: DATE_A,
      lineUserId: "U_z",
      displayName: "支払い済みさん",
      enteredAt: "2026-07-01T00:00:00.000Z",
      status: "paid",
      paymentStatus: "paid",
    });
    const body = await (await GET(req(undefined, { eventDate: DATE_A }))).json();
    expect(body.count).toBe(3);
    expect(body.full).toBe(false);
    expect(body.entries.map((e: { displayStatus: string }) => e.displayStatus).sort()).toEqual([
      "joined_unpaid",
      "paid",
      "unpaid",
    ]);
  });
});

describe("DELETE /api/mahjong/entries", () => {
  test("本番でも pending は取消でき、月ロックも解放される", async () => {
    db.__set("mahjongEntries", ENTRY_A, pendingEntry(DATE_A, USER, 10));
    db.__set("mahjongMonthlyLocks", `${SEASON}_${USER}_2026-07`, {
      seasonId: SEASON,
      lineUserId: USER,
      ym: "2026-07",
      eventDate: DATE_A,
    });
    const res = await DELETE(req(undefined, { eventDate: DATE_A }));
    expect(res.status).toBe(200);
    expect(db.__size("mahjongEntries")).toBe(0);
    expect(db.__size("mahjongMonthlyLocks")).toBe(0);
  });

  test("支払い済みは取消できない（返金漏れを防ぐ）", async () => {
    db.__set("mahjongEntries", ENTRY_A, {
      seasonId: SEASON,
      eventDate: DATE_A,
      lineUserId: USER,
      status: "paid",
      paymentStatus: "paid",
    });
    const res = await DELETE(req(undefined, { eventDate: DATE_A }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("PAID_LOCKED");
    expect(db.__size("mahjongEntries")).toBe(1);
  });
});

describe("isActiveMahjongEntry（席を持っているか）", () => {
  test("支払い済み・返金対応中は席を持つ", () => {
    expect(isActiveMahjongEntry({ status: "paid" })).toBe(true);
    expect(isActiveMahjongEntry({ paymentStatus: "paid" })).toBe(true);
    expect(isActiveMahjongEntry({ status: "cancelRequested" })).toBe(true);
  });

  test("仮押さえは期限内・期限切れを問わず席を持つ（2026-09-11: 未払いも席を保持）", () => {
    expect(
      isActiveMahjongEntry({ paymentStatus: "pending", pendingExpiresAt: "2999-01-01T00:00:00.000Z" })
    ).toBe(true);
    expect(
      isActiveMahjongEntry({ paymentStatus: "pending", pendingExpiresAt: "2000-01-01T00:00:00.000Z" })
    ).toBe(true);
    expect(isActiveMahjongEntry({ paymentStatus: "pending" })).toBe(true);
    expect(isActiveMahjongEntry({ status: "reserved" })).toBe(true);
  });

  test("refunded・cancelRejected は席を持たない", () => {
    expect(isActiveMahjongEntry({ status: "refunded" })).toBe(false);
    expect(isActiveMahjongEntry({ status: "cancelRejected" })).toBe(false);
  });
});

describe("isUnpaidMahjongEntry（席は持つが支払いが済んでいない）", () => {
  const now = new Date("2026-07-01T00:00:00.000Z");

  test("旧 reserved（paymentStatus なし）と期限切れ pending は未払い", () => {
    expect(isUnpaidMahjongEntry({ status: "reserved" }, now)).toBe(true);
    expect(
      isUnpaidMahjongEntry(
        { status: "reserved", paymentStatus: "pending", pendingExpiresAt: "2026-06-30T23:59:59.000Z" },
        now
      )
    ).toBe(true);
    // 期限ちょうどは失効扱い＝未払い。
    expect(
      isUnpaidMahjongEntry(
        { status: "reserved", paymentStatus: "pending", pendingExpiresAt: "2026-07-01T00:00:00.000Z" },
        now
      )
    ).toBe(true);
  });

  test("期限内 pending（お支払い確認中）・paid・cancelRequested・refunded は未払いではない", () => {
    expect(
      isUnpaidMahjongEntry(
        { status: "reserved", paymentStatus: "pending", pendingExpiresAt: "2026-07-01T00:00:01.000Z" },
        now
      )
    ).toBe(false);
    expect(isUnpaidMahjongEntry({ status: "paid" }, now)).toBe(false);
    expect(isUnpaidMahjongEntry({ paymentStatus: "paid" }, now)).toBe(false);
    expect(isUnpaidMahjongEntry({ status: "cancelRequested" }, now)).toBe(false);
    expect(isUnpaidMahjongEntry({ status: "refunded" }, now)).toBe(false);
  });
});


describe("未払い（席は持つ・支払い前）の表示と支払い", () => {
  const reservedEntry = (eventDate: string, lineUserId: string): Data => ({
    seasonId: SEASON,
    eventDate,
    lineUserId,
    displayName: lineUserId,
    enteredAt: "2026-07-01T00:00:00.000Z",
    status: "reserved",
  });

  test("GET ?mine=1 は未払いに unpaid:true を付け、終了した開催日の未払いは返さない", async () => {
    for (const eventDate of [DATE_A, "2026-06-01"]) {
      db.__set("mahjongEntries", buildMahjongEntryId(SEASON, eventDate, USER), reservedEntry(eventDate, USER));
    }
    const body = await (await GET(req(undefined, { mine: "1" }))).json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({ eventDate: DATE_A, unpaid: true, paymentStatus: null });
  });

  test("GET ?eventDate= は未払いを名前入り・席ありで出す（count / entered に含む）", async () => {
    db.__set("mahjongEntries", ENTRY_A, reservedEntry(DATE_A, USER));
    const body = await (await GET(req(undefined, { eventDate: DATE_A }))).json();
    expect(body.count).toBe(1);
    expect(body.full).toBe(false);
    expect(body.entered).toBe(true);
    expect(body.entries).toEqual([
      expect.objectContaining({ displayName: USER, displayStatus: "unpaid", isMe: true }),
    ]);
  });

  test("PAY は未払い entry に新しい決済リンクを発行して pending に戻し、enteredAt を保持する", async () => {
    db.__set("mahjongEntries", ENTRY_A, reservedEntry(DATE_A, USER));
    const res = await PAY(req({ eventDate: DATE_A }));
    expect(res.status).toBe(200);
    expect((await res.json()).paymentUrl).toBe("https://square.link/pay-1");
    const saved = db.__get("mahjongEntries", ENTRY_A)!;
    expect(saved.paymentStatus).toBe("pending");
    expect(new Date(saved.pendingExpiresAt as string).getTime()).toBeGreaterThan(Date.now());
    expect(saved.paymentTransactionId).toBe("ORDER1");
    expect(saved.enteredAt).toBe("2026-07-01T00:00:00.000Z");
  });

  test("PAY は期限切れ pending に古い URL を返さず、発行し直す", async () => {
    db.__set("mahjongEntries", ENTRY_A, { ...pendingEntry(DATE_A, USER, -1), paymentUrl: "https://square.link/old" });
    const res = await PAY(req({ eventDate: DATE_A }));
    expect(res.status).toBe(200);
    expect((await res.json()).paymentUrl).toBe("https://square.link/pay-1");
    expect(db.__get("mahjongEntries", ENTRY_A)!.paymentTransactionId).toBe("ORDER1");
  });

  test("POST は paid 7件と未払い 1件を8席と数えて満員にする", async () => {
    for (let i = 0; i < 7; i++) {
      db.__set("mahjongEntries", buildMahjongEntryId(SEASON, DATE_A, `U_paid_${i}`), {
        ...reservedEntry(DATE_A, `U_paid_${i}`),
        status: "paid",
        paymentStatus: "paid",
      });
    }
    db.__set("mahjongEntries", buildMahjongEntryId(SEASON, DATE_A, "U_unpaid"), reservedEntry(DATE_A, "U_unpaid"));
    (requireGameUserWithRole as jest.Mock).mockResolvedValue({ lineUserId: "U_new", role: "member", monthlyEntryExempt: false });
    (requireGameUser as jest.Mock).mockResolvedValue("U_new");
    db.__set("users", "U_new", { displayName: "新規参加者" });
    const res = await POST(req({ eventDate: DATE_A }));
    expect(res.status).toBe(409);
    expect((await res.json()).full).toBe(true);
    expect(db.__get("mahjongEntries", buildMahjongEntryId(SEASON, DATE_A, "U_new"))).toBeUndefined();
  });
});
