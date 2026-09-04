/**
 * 単体テスト: 麻雀「ゲーム開始」の人数判定（startDay / startGameDay）
 *
 * 背景（2026-09-04 本番）: 社員1名＋会員3名の計4名で「ゲーム開始」を押したが開始できなかった。
 * 社員（staff）は参加費免除で entry に `status: "paid"` だけが書かれ `paymentStatus` は無い。
 * GM 画面のプール（day/assignment）・卓振り分け（day/assign）・流会（mahjongForfeit）は
 * `deriveStatus()` で数えるため社員を含むが、開始判定の `fetchPaidParticipants` だけが
 * `paymentStatus === "paid"` で数えていた＝画面は4名なのにサーバーは3名と判定して拒否。
 *
 * 固定する仕様:
 *  - 社員（status:"paid" のみ）も「支払い済み」として数える（他の判定と同じ deriveStatus）
 *  - 未払い（reserved）・キャンセル依頼中・返金済みは数えない
 *  - 支払い済み4名未満なら開始しない
 */
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/auditLog", () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));

import { getDb } from "@/lib/firebaseAdmin";
import { startDay, startGameDay } from "@/lib/mahjongDay";

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
    update: async (d: Data) => { col(c).set(id, { ...(col(c).get(id) ?? {}), ...d }); },
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
      update: (ref: ReturnType<typeof docRef>, d: Data) => void;
    }) => Promise<T>): Promise<T> =>
      fn({
        get: (ref) => ref.get(),
        update: (ref, d) => { col(ref.__c).set(ref.id, { ...(col(ref.__c).get(ref.id) ?? {}), ...d }); },
      }),
  };
}

const SEASON = "season-1";
const DATE = "2026-09-05";
const GM = "U-gm";

function entry(id: string, fields: Data): Data {
  return { seasonId: SEASON, eventDate: DATE, lineUserId: id, displayName: id, enteredAt: `2026-09-01T00:00:0${id.length}Z`, ...fields };
}

describe("麻雀 ゲーム開始の人数判定", () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(() => {
    db = makeDb();
    (getDb as jest.Mock).mockReturnValue(db);
  });

  test("社員1名（status:paid のみ）＋会員3名（paymentStatus:paid）で開始できる", async () => {
    db.__seed("mahjongEntries", "e-staff", entry("U-staff", { status: "paid" })); // 参加費免除＝paymentStatus 無し
    db.__seed("mahjongEntries", "e-m1", entry("U-m1", { status: "paid", paymentStatus: "paid" }));
    db.__seed("mahjongEntries", "e-m2", entry("U-m2", { status: "paid", paymentStatus: "paid" }));
    db.__seed("mahjongEntries", "e-m3", entry("U-m3", { paymentStatus: "paid" })); // 旧データ（status 無し）

    // 画面側の startDay（dayState 生成）も同じ判定で4名と数える
    expect(await startDay(SEASON, DATE)).toBe(true);

    const result = await startGameDay(SEASON, DATE, GM);
    expect(result).toEqual({ ok: true, already: false, paidCount: 4 });
    const day = db.__get("mahjongDayState", `${SEASON}_${DATE}`)!;
    expect(day.entryClosedAt).toEqual(expect.any(String));
    expect(day.startedBy).toBe(GM);
  });

  test("未払い・キャンセル依頼中・返金済みは数えない（社員含めて3名なら開始しない）", async () => {
    db.__seed("mahjongEntries", "e-staff", entry("U-staff", { status: "paid" }));
    db.__seed("mahjongEntries", "e-m1", entry("U-m1", { status: "paid", paymentStatus: "paid" }));
    db.__seed("mahjongEntries", "e-m2", entry("U-m2", { paymentStatus: "paid" }));
    db.__seed("mahjongEntries", "e-unpaid", entry("U-unpaid", { status: "reserved" }));
    db.__seed("mahjongEntries", "e-cancel", entry("U-cancel", { status: "cancelRequested", paymentStatus: "cancelRequested" }));
    db.__seed("mahjongEntries", "e-refund", entry("U-refund", { status: "refunded", paymentStatus: "paid" }));
    // dayState は既にある前提（人数判定だけを見る）
    db.__seed("mahjongDayState", `${SEASON}_${DATE}`, { seasonId: SEASON, eventDate: DATE, round: 1, waiting: [], awaitingAssignment: true });

    const result = await startGameDay(SEASON, DATE, GM);
    expect(result).toEqual({ ok: false, error: "支払い済みが4名以上必要です", paidCount: 3 });
    expect(db.__get("mahjongDayState", `${SEASON}_${DATE}`)!.entryClosedAt).toBeUndefined();
  });
});

describe("想定外のデータ", () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(() => {
    db = makeDb();
    (getDb as jest.Mock).mockReturnValue(db);
  });

  test("enteredAt が欠けた entry があっても 500 にならず数えられる", async () => {
    db.__seed("mahjongEntries", "e-broken", { seasonId: SEASON, eventDate: DATE, lineUserId: "U-b", displayName: "b", status: "paid" });
    db.__seed("mahjongEntries", "e-m1", entry("U-m1", { paymentStatus: "paid" }));
    db.__seed("mahjongEntries", "e-m2", entry("U-m2", { paymentStatus: "paid" }));
    db.__seed("mahjongEntries", "e-m3", entry("U-m3", { paymentStatus: "paid" }));
    expect(await startDay(SEASON, DATE)).toBe(true);
    expect(await startGameDay(SEASON, DATE, GM)).toMatchObject({ ok: true, paidCount: 4 });
  });

  test("決済リンク発行中（paymentStatus:pending）・未知の status は数えない", async () => {
    db.__seed("mahjongEntries", "e-p", entry("U-p", { paymentStatus: "pending" }));
    db.__seed("mahjongEntries", "e-w", entry("U-w", { status: "weird" }));
    db.__seed("mahjongEntries", "e-m1", entry("U-m1", { paymentStatus: "paid" }));
    db.__seed("mahjongEntries", "e-m2", entry("U-m2", { paymentStatus: "paid" }));
    db.__seed("mahjongEntries", "e-m3", entry("U-m3", { paymentStatus: "paid" }));
    db.__seed("mahjongDayState", `${SEASON}_${DATE}`, { seasonId: SEASON, eventDate: DATE, round: 1, waiting: [], awaitingAssignment: true });
    expect(await startGameDay(SEASON, DATE, GM)).toMatchObject({ ok: false, paidCount: 3 });
  });

  test("既に開始済みなら人数が減っていても already で冪等（二度目の締切を打たない）", async () => {
    db.__seed("mahjongDayState", `${SEASON}_${DATE}`, { seasonId: SEASON, eventDate: DATE, round: 2, entryClosedAt: "2026-09-05T03:00:00Z", startedBy: "U-first" });
    expect(await startGameDay(SEASON, DATE, GM)).toEqual({ ok: true, already: true, paidCount: 0 });
    expect(db.__get("mahjongDayState", `${SEASON}_${DATE}`)!.startedBy).toBe("U-first");
  });
});
