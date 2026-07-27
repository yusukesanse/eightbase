/**
 * 単体テスト（再発防止）: 当日GM（ダーツ / ビリヤード）の自己選出と引き継ぎ。
 *
 * ダーツ・ビリヤードの GM は **シーズン固定（Season.gameMasterIds）ではなく開催日ごと** に
 * 参加者が「GMをやる」で決める（`src/lib/dayGameMaster.ts`）。ここで守るべき不変条件:
 *  - **支払い済みの参加者**しかGMになれない（未払い・参加表明なしは403）
 *  - 交代できる（担当が帰ると当日フローが詰むため）
 *  - **`start*Day()` の `tx.set` は全上書きなので、GMを引き継がないと開始した瞬間にGM不在になる**
 *    ＝ 以降の進行が全部403になる。この回帰をここで止める（麻雀の entryClosedAt 消失と同型の罠）。
 *  - 中止・終了済みの開催日ではGMになれない
 */

jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/dartsSchedule", () => ({
  isScheduledDartsDate: jest.fn().mockResolvedValue(true),
  isDartsCancelledDate: jest.fn().mockResolvedValue(false),
}));
jest.mock("@/lib/billiardsSchedule", () => ({
  isScheduledBilliardsDate: jest.fn().mockResolvedValue(true),
  isBilliardsCancelledDate: jest.fn().mockResolvedValue(false),
}));

import { getDb } from "@/lib/firebaseAdmin";
import { claimDartsGm, startDartsDay, removeDartsParticipant } from "@/lib/dartsDay";
import { claimBilliardsGm, startBilliardsDay } from "@/lib/billiardsDay";
import type { DartsDayState } from "@/types/darts";
import type { BilliardsDayState } from "@/types/billiards";

/* ───────── In-memory Firestore モック（dartsDayTx.test.ts と同方式） ───────── */
type Data = Record<string, unknown>;
function makeDb() {
  const store = new Map<string, Map<string, Data>>();
  const col = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name)!;
  };
  const docRef = (c: string, id: string) => ({
    __c: c,
    id,
    get: async () => ({ exists: col(c).has(id), id, data: () => col(c).get(id) }),
  });
  const queryRef = (c: string) => ({
    __c: c,
    where() {
      return this;
    },
    get: async () => ({
      docs: Array.from(col(c).entries()).map(([id, data]) => ({ id, data: () => data })),
    }),
  });
  return {
    __store: store,
    collection: (c: string) => ({
      doc: (id: string) => docRef(c, id),
      where: () => queryRef(c),
    }),
    runTransaction: async (fn: (tx: unknown) => unknown) => {
      const tx = {
        get: async (r: { __c: string; id?: string; get: () => Promise<unknown> }) => r.get(),
        set: (r: { __c: string; id: string }, data: Data, opts?: { merge?: boolean }) => {
          const cur = col(r.__c).get(r.id);
          col(r.__c).set(r.id, opts?.merge ? { ...(cur ?? {}), ...data } : { ...data });
        },
        update: (r: { __c: string; id: string }, data: Data) => {
          col(r.__c).set(r.id, { ...(col(r.__c).get(r.id) ?? {}), ...data });
        },
        delete: (r: { __c: string; id: string }) => col(r.__c).delete(r.id),
      };
      return fn(tx);
    },
  };
}

let db: ReturnType<typeof makeDb>;
const SEASON = "s1";
const DATE = "2026-07-18";
beforeEach(() => {
  db = makeDb();
  (getDb as jest.Mock).mockReturnValue(db);
});

function seedEntry(collection: string, uid: string, i: number, status: "paid" | "reserved") {
  const c = db.__store.get(collection) ?? new Map();
  db.__store.set(collection, c);
  c.set(`${SEASON}_${DATE}_${uid}`, {
    seasonId: SEASON,
    eventDate: DATE,
    lineUserId: uid,
    displayName: uid.toUpperCase(),
    status,
    ...(status === "paid" ? { paymentStatus: "paid", paymentTransactionId: `ord-${uid}`, paymentAmount: 500 } : {}),
    enteredAt: `2026-07-18T09:0${i}:00.000Z`,
  });
}
const dartsDay = () => db.__store.get("dartsDayState")?.get(`${SEASON}_${DATE}`) as DartsDayState | undefined;
const billiardsDay = () => db.__store.get("billiardsDayState")?.get(`${SEASON}_${DATE}`) as BilliardsDayState | undefined;
const writeDartsDay = (d: DartsDayState) =>
  db.__store.get("dartsDayState")!.set(`${SEASON}_${DATE}`, d as unknown as Record<string, unknown>);
const seedDartsPaid = (uids: string[]) => uids.forEach((u, i) => seedEntry("dartsEntries", u, i, "paid"));
const seedBilliardsPaid = (uids: string[]) => uids.forEach((u, i) => seedEntry("billiardsEntries", u, i, "paid"));

describe("claimDartsGm（当日GMの自己選出）", () => {
  test("支払い済み参加者はGMになれる（当日stateが無ければ作る・受付は開いたまま）", async () => {
    seedDartsPaid(["a", "b", "c", "d"]);
    const r = await claimDartsGm(SEASON, DATE, "a");
    expect(r).toEqual({ ok: true });
    expect(dartsDay()?.gmUserId).toBe("a");
    expect(dartsDay()?.gmDisplayName).toBe("A");
    // GMを決めただけでは受付は締まらない（開始は別操作）
    expect(dartsDay()?.entryClosedAt).toBeNull();
  });

  // 未払いの人は名簿には出る（参加者）が進行には参加しないので、**GMにはなれない**。
  // 当日その場で支払えばGMになれる（支払い完了で participants[].paid が true になる）。
  test("未払い（reserved）はGMになれない", async () => {
    seedDartsPaid(["a"]);
    seedEntry("dartsEntries", "z", 5, "reserved");
    const r = await claimDartsGm(SEASON, DATE, "z");
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect(dartsDay()).toBeUndefined();
  });

  test("参加表明していない人はGMになれない", async () => {
    seedDartsPaid(["a", "b"]);
    const r = await claimDartsGm(SEASON, DATE, "stranger");
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  test("交代できる（担当が帰った場合に詰まないこと）", async () => {
    seedDartsPaid(["a", "b", "c", "d"]);
    await claimDartsGm(SEASON, DATE, "a");
    const r = await claimDartsGm(SEASON, DATE, "b");
    expect(r).toEqual({ ok: true });
    expect(dartsDay()?.gmUserId).toBe("b");
    expect(dartsDay()?.gmDisplayName).toBe("B");
  });

  test("開始後は確定済み参加者からのみ交代できる", async () => {
    seedDartsPaid(["a", "b", "c", "d"]);
    await claimDartsGm(SEASON, DATE, "a");
    await startDartsDay(SEASON, DATE, "a");
    // 開始後に支払ったつもりの新規エントリーは participants に居ないので不可
    seedEntry("dartsEntries", "late", 8, "paid");
    expect(await claimDartsGm(SEASON, DATE, "late")).toMatchObject({ ok: false, status: 403 });
    expect(await claimDartsGm(SEASON, DATE, "c")).toEqual({ ok: true });
    expect(dartsDay()?.gmUserId).toBe("c");
  });

  test("中止された開催日ではGMになれない", async () => {
    seedDartsPaid(["a", "b", "c", "d"]);
    const c = db.__store.get("dartsCancelledDates") ?? new Map();
    db.__store.set("dartsCancelledDates", c);
    c.set(DATE, { cancelledAt: "2026-07-18T00:00:00.000Z" });
    expect(await claimDartsGm(SEASON, DATE, "a")).toMatchObject({ ok: false, status: 409 });
  });
});

describe("startDartsDay は当日GMを引き継ぐ（tx.set 全上書きの罠）", () => {
  test("開始しても gmUserId / gmDisplayName が消えない", async () => {
    seedDartsPaid(["a", "b", "c", "d"]);
    await claimDartsGm(SEASON, DATE, "b");
    const r = await startDartsDay(SEASON, DATE, "b");
    expect(r).toMatchObject({ ok: true, already: false, paidCount: 4 });
    expect(dartsDay()?.gmUserId).toBe("b"); // ← 落とすと開始直後にGM不在になり進行が全部403
    expect(dartsDay()?.gmDisplayName).toBe("B");
    expect(dartsDay()?.entryClosedAt).toBeTruthy();
  });

  test("GMが交代していたら交代後のGMが引き継がれる（開始操作者で上書きしない）", async () => {
    seedDartsPaid(["a", "b", "c", "d"]);
    await claimDartsGm(SEASON, DATE, "a");
    await claimDartsGm(SEASON, DATE, "d");
    await startDartsDay(SEASON, DATE, "d");
    expect(dartsDay()?.gmUserId).toBe("d");
    expect(dartsDay()?.startedBy).toBe("d");
  });
});

describe("ビリヤードも同じ（claim / 引き継ぎ）", () => {
  test("支払い済み参加者がGMになり、開始しても引き継がれる", async () => {
    seedBilliardsPaid(["a", "b", "c", "d"]);
    expect(await claimBilliardsGm(SEASON, DATE, "c")).toEqual({ ok: true });
    expect(billiardsDay()?.gmUserId).toBe("c");
    expect(billiardsDay()?.entryClosedAt).toBeNull();

    const r = await startBilliardsDay(SEASON, DATE, "c");
    expect(r).toMatchObject({ ok: true, already: false });
    expect(billiardsDay()?.gmUserId).toBe("c");
    expect(billiardsDay()?.gmDisplayName).toBe("C");
    expect(billiardsDay()?.entryClosedAt).toBeTruthy();
  });

  test("非参加者はGMになれない", async () => {
    seedBilliardsPaid(["a", "b"]);
    expect(await claimBilliardsGm(SEASON, DATE, "stranger")).toMatchObject({ ok: false, status: 403 });
  });
});

/* ───────── 未払いの扱い・参加剥奪 ───────── */

describe("未払いは名簿に出るが進行には参加しない", () => {
  test("開始時の participants に未払いも入るが paid=false で区別される", async () => {
    seedDartsPaid(["a", "b", "c", "d"]);
    seedEntry("dartsEntries", "z", 6, "reserved");
    await claimDartsGm(SEASON, DATE, "a");
    const r = await startDartsDay(SEASON, DATE, "a");
    expect(r).toMatchObject({ ok: true });
    const members = dartsDay()!.participants;
    expect(members.map((p) => p.lineUserId).sort()).toEqual(["a", "b", "c", "d", "z"]);
    expect(members.find((p) => p.lineUserId === "z")?.paid).toBe(false);
    expect(members.find((p) => p.lineUserId === "a")?.paid).toBe(true);
  });

  test("支払い済みが最少人数に満たなければ開始できない（未払いは数えない）", async () => {
    seedDartsPaid(["a", "b", "c"]);
    seedEntry("dartsEntries", "z", 6, "reserved");
    await claimDartsGm(SEASON, DATE, "a");
    const r = await startDartsDay(SEASON, DATE, "a");
    expect(r).toMatchObject({ ok: false, paidCount: 3 });
  });
});

describe("removeDartsParticipant（GMの参加剥奪）", () => {
  const startWith = async (paid: string[], unpaid: string[] = []) => {
    seedDartsPaid(paid);
    unpaid.forEach((u, i) => seedEntry("dartsEntries", u, 6 + i, "reserved"));
    await claimDartsGm(SEASON, DATE, paid[0]);
    await startDartsDay(SEASON, DATE, paid[0]);
  };

  test("未払いの人を外せる", async () => {
    await startWith(["a", "b", "c", "d"], ["z"]);
    expect(await removeDartsParticipant(SEASON, DATE, "z")).toEqual({ ok: true });
    expect(dartsDay()!.participants.map((p) => p.lineUserId)).not.toContain("z");
  });

  test("外した人の申告値も消える", async () => {
    await startWith(["a", "b", "c", "d"]);
    const day = dartsDay()!;
    day.events[0].reports = { d: { value: 10, reportedAt: "2026-07-18T10:00:00.000Z" } };
    writeDartsDay(day);
    expect(await removeDartsParticipant(SEASON, DATE, "d")).toEqual({ ok: true });
    expect(dartsDay()!.events[0].reports.d).toBeUndefined();
  });

  test("確定済みの種目があると外せない（他の人の順位ptが動くため）", async () => {
    await startWith(["a", "b", "c", "d"]);
    const day = dartsDay()!;
    day.events[0].status = "confirmed";
    writeDartsDay(day);
    expect(await removeDartsParticipant(SEASON, DATE, "d")).toMatchObject({ ok: false, status: 409 });
    expect(dartsDay()!.participants.map((p) => p.lineUserId)).toContain("d");
  });

  test("参加者でない人は外せない", async () => {
    await startWith(["a", "b", "c", "d"]);
    expect(await removeDartsParticipant(SEASON, DATE, "stranger")).toMatchObject({ ok: false, status: 400 });
  });
});
