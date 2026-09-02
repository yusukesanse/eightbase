/**
 * 単体テスト: POST /api/admin/mahjong/entries（管理者が参加者を「支払い済み」で追加）
 *
 * 背景: 支払い済みの人がミニアプリでキャンセルすると entry は cancelRequested/refunded になるが、
 * Square 側で返金していなければ入金は成立したまま。この人を当日の卓に戻す手段が無かった
 * （受付締切後は利用者側から再表明できない）。
 *
 * 固定する仕様:
 *  - 既定で paymentStatus/status を paid にする（＝GM の卓振り分けプールに入る）
 *  - 返金対応中・返金済みの既存エントリーも paid に戻せる（enteredAt は最初の値を保つ）
 *  - 受付締切（mahjongDayState.entryClosedAt）は見ない＝締切後でも追加できる
 *  - 月ロックは管理者追加でも書く（書かないとその月が無制限のまま残る）
 *  - アクティブでないシーズンには追加できない（409）
 *  - 誰が誰を支払い済みにしたかを監査ログに残す
 */
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/adminAuth", () => ({ checkAdminAuth: jest.fn().mockResolvedValue("admin@example.com") }));
jest.mock("@/lib/auditLog", () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/mahjong", () => ({ getActiveSeason: jest.fn() }));

import { getDb } from "@/lib/firebaseAdmin";
import { writeAuditLog } from "@/lib/auditLog";
import { getActiveSeason } from "@/lib/mahjong";
import { POST, DELETE } from "@/app/api/admin/mahjong/entries/route";
import type { NextRequest } from "next/server";

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
    set: async (d: Data) => { col(c).set(id, { ...d }); },
    update: async (d: Data) => {
      const cur = col(c).get(id) ?? {};
      col(c).set(id, { ...cur, ...d });
    },
    delete: async () => { col(c).delete(id); },
  });
  const query = (c: string, conds: [string, unknown][], lim?: number) => ({
    where: (f: string, _op: string, v: unknown) => query(c, [...conds, [f, v]], lim),
    limit: (n: number) => query(c, conds, n),
    get: async () => {
      const rows = [...col(c).entries()]
        .filter(([, v]) => conds.every(([f, val]) => v[f] === val))
        .map(([id, v]) => ({ id, data: () => v }));
      const docs = lim == null ? rows : rows.slice(0, lim);
      return { docs, empty: docs.length === 0, size: docs.length };
    },
  });
  return {
    runTransaction: async (fn: (tx: {
      get: (ref: ReturnType<typeof docRef>) => ReturnType<ReturnType<typeof docRef>["get"]>;
      set: (ref: ReturnType<typeof docRef>, d: Data, opt?: { merge?: boolean }) => void;
      update: (ref: ReturnType<typeof docRef>, d: Data) => void;
    }) => Promise<void>) => {
      const tx = {
        get: (ref: ReturnType<typeof docRef>) => ref.get(),
        set: (ref: ReturnType<typeof docRef>, d: Data, opt?: { merge?: boolean }) => {
          const cur = opt?.merge ? (col(ref.__c).get(ref.id) ?? {}) : {};
          col(ref.__c).set(ref.id, { ...cur, ...d });
        },
        update: (ref: ReturnType<typeof docRef>, d: Data) => {
          const cur = col(ref.__c).get(ref.id) ?? {};
          col(ref.__c).set(ref.id, { ...cur, ...d });
        },
      };
      await fn(tx);
    },
    batch: () => {
      const ops: [string, string, Data, boolean][] = [];
      return {
        // merge:true は既存フィールドを残す（paymentTransactionId 等を消さない）。
        set: (ref: { __c: string; id: string }, d: Data, opt?: { merge?: boolean }) => {
          ops.push([ref.__c, ref.id, d, opt?.merge === true]);
        },
        commit: async () => {
          ops.forEach(([c, id, d, merge]) => {
            col(c).set(id, merge ? { ...(col(c).get(id) ?? {}), ...d } : { ...d });
          });
        },
      };
    },
    collection: (c: string) => ({
      doc: (id: string) => docRef(c, id),
      where: (f: string, _op: string, v: unknown) => query(c, [[f, v]]),
    }),
    __store: store,
    __get: (c: string, id: string) => store.get(c)?.get(id),
    __set: (c: string, id: string, d: Data) => col(c).set(id, d),
  };
}

let db: ReturnType<typeof makeDb>;

const SEASON = "s1";
const DATE = "2026-08-01";
const ENTRY_ID = `${SEASON}_${DATE}_U1`;

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function delReq(params: Record<string, string>): NextRequest {
  const url = new URL(`https://x/api/admin/mahjong/entries?${new URLSearchParams(params)}`);
  return { nextUrl: url } as unknown as NextRequest;
}

beforeEach(() => {
  db = makeDb();
  (getDb as jest.Mock).mockReturnValue(db);
  (writeAuditLog as jest.Mock).mockClear();
  (getActiveSeason as jest.Mock).mockResolvedValue({ seasonId: SEASON });
  db.__set("authorizedUsers", "auth-1", {
    lineUserId: "U1", displayName: "会員A", role: "member", active: true,
  });
  db.__set("users", "U1", { displayName: "会員A", pictureUrl: "https://example.com/U1.png" });
});

const add = (over: Data = {}) =>
  POST(req({ seasonId: SEASON, eventDate: DATE, lineUserId: "U1", ...over }));

describe("支払い済みで追加", () => {
  test("新規追加は paid で入り、GM の卓振り分けプール条件を満たす", async () => {
    const res = await add();
    expect(res.status).toBe(201);

    const entry = db.__get("mahjongEntries", ENTRY_ID) as Data;
    expect(entry.paymentStatus).toBe("paid"); // fetchPaidParticipants の条件
    expect(entry.status).toBe("paid");
    expect(entry.paymentAmount).toBe(3000);
    expect(entry.paidAt).toEqual(expect.any(String));
    // 表示名はサーバーが解決する（クライアント値を信用しない）
    expect(entry.displayName).toBe("会員A");
  });

  test("月ロックを書く（管理者追加でもその月を消費する）", async () => {
    await add();
    expect(db.__get("mahjongMonthlyLocks", `${SEASON}_U1_2026-08`)).toMatchObject({
      eventDate: DATE,
      lineUserId: "U1",
    });
  });

  test("受付締切後（entryClosedAt あり）でも追加できる", async () => {
    db.__set("mahjongDayState", `${SEASON}_${DATE}`, {
      seasonId: SEASON, eventDate: DATE, entryClosedAt: "2026-08-01T04:00:00.000Z",
    });
    const res = await add();
    expect(res.status).toBe(201);
    expect((db.__get("mahjongEntries", ENTRY_ID) as Data).paymentStatus).toBe("paid");
  });

  test("キャンセル依頼中/返金済みの人も paid に戻せる（enteredAt と決済照合IDは保つ）", async () => {
    db.__set("mahjongEntries", ENTRY_ID, {
      seasonId: SEASON, eventDate: DATE, lineUserId: "U1", displayName: "会員A",
      enteredAt: "2026-07-20T01:00:00.000Z",
      status: "refunded", paymentStatus: "cancelRequested",
      paymentTransactionId: "order-123",
    });

    const res = await add();
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ previousStatus: "refunded" });

    const entry = db.__get("mahjongEntries", ENTRY_ID) as Data;
    expect(entry.status).toBe("paid");
    expect(entry.paymentStatus).toBe("paid");
    // 最初の参加時刻を保つ（卓振り分けの FIFO 順が入れ替わらないように）
    expect(entry.enteredAt).toBe("2026-07-20T01:00:00.000Z");
    // merge なので決済照合情報は消さない
    expect(entry.paymentTransactionId).toBe("order-123");
  });

  test("markPaid:false なら未払い（reserved）で追加する", async () => {
    await add({ markPaid: false });
    const entry = db.__get("mahjongEntries", ENTRY_ID) as Data;
    expect(entry.status).toBe("reserved");
    expect(entry.paymentStatus).toBeUndefined();
  });

  test("誰が支払い済みにしたかを監査ログに残す", async () => {
    await add();
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "entry.adminAdded",
        gameCategory: "mahjong",
        actor: "admin:admin@example.com",
        afterStatus: "paid",
        target: expect.objectContaining({ lineUserId: "U1", date: DATE }),
      })
    );
  });
});

describe("拒否する入力", () => {
  test("開催中でないシーズンには追加できない", async () => {
    const res = await add({ seasonId: "old-season" });
    expect(res.status).toBe(409);
    expect(db.__get("mahjongEntries", `old-season_${DATE}_U1`)).toBeUndefined();
  });

  test("存在しないユーザーは追加できない", async () => {
    const res = await POST(req({ seasonId: SEASON, eventDate: DATE, lineUserId: "UNKNOWN" }));
    expect(res.status).toBe(400);
    expect(db.__store.get("mahjongEntries")?.size ?? 0).toBe(0);
  });

  test("日付の形式が不正なら 400", async () => {
    expect((await add({ eventDate: "2026/08/01" })).status).toBe(400);
  });
});

describe("削除", () => {
  test("参加者を削除し、監査ログに直前の状態を残す", async () => {
    await add();
    const res = await DELETE(delReq({ eventDate: DATE, lineUserId: "U1" }));
    expect(res.status).toBe(200);
    expect(db.__get("mahjongEntries", ENTRY_ID)).toBeUndefined();
    expect(writeAuditLog).toHaveBeenLastCalledWith(
      expect.objectContaining({ eventType: "entry.adminRemoved", beforeStatus: "paid" })
    );
  });
});
