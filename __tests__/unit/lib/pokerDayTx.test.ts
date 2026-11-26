/**
 * 単体テスト: src/lib/pokerDay.ts の当日進行（ディーラー主導・複数試合・In-memory Firestore モック）。
 * ダーツ/ビリヤードの Tx テストと対称。要件 docs/games/poker/ポーカー-ルール草案.md §4〜§6。
 *
 * 検証: ディーラー選出→開始（受付締切・参加者確定）→終了→チップ申告→ディーラー確定→
 *       当日 scores 集計、代理入力/権限、次試合、中止（確定済みは不可）。
 */

jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/line", () => ({ sendGameForfeitNotice: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/pokerSchedule", () => ({
  isScheduledPokerDate: jest.fn().mockResolvedValue(true),
  isPokerCancelledDate: jest.fn().mockResolvedValue(false),
}));

import { getDb } from "@/lib/firebaseAdmin";
import {
  assignPokerDealer,
  startPokerGame,
  endPokerGame,
  reportPokerChips,
  confirmPokerGame,
  cancelPokerDay,
  effectivePokerGameStatus,
  pokerDayResults,
} from "@/lib/pokerDay";
import type { PokerDayState } from "@/types/poker";

/* ───────── In-memory Firestore モック（transaction） ───────── */
type Data = Record<string, unknown>;
type Ref = { __c: string; id: string };
function makeDb() {
  const store = new Map<string, Map<string, Data>>();
  let auto = 0;
  const col = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name)!;
  };
  const mutate = {
    set: (c: string, id: string, data: Data, merge?: boolean) => {
      const cur = col(c).get(id);
      col(c).set(id, merge ? { ...(cur ?? {}), ...data } : { ...data });
    },
    create: (c: string, id: string, data: Data) => {
      if (col(c).has(id)) throw new Error("ALREADY_EXISTS");
      col(c).set(id, { ...data });
    },
    delete: (c: string, id: string) => col(c).delete(id),
  };
  const docRef = (c: string, id?: string) => {
    const _id = id ?? `auto${++auto}`;
    return {
      __c: c,
      id: _id,
      get: async () => ({ exists: col(c).has(_id), id: _id, data: () => col(c).get(_id) }),
    };
  };
  const runQuery = (c: string, filters: [string, unknown][]) => {
    const docs = Array.from(col(c).entries())
      .filter(([, data]) => filters.every(([f, v]) => data[f] === v))
      .map(([id, data]) => ({ id, data: () => data }));
    return { docs, size: docs.length, empty: docs.length === 0 };
  };
  const query = (c: string, filters: [string, unknown][]) => ({
    __c: c,
    __filters: filters,
    where: (f: string, _op: string, v: unknown) => query(c, [...filters, [f, v]]),
    get: async () => runQuery(c, filters),
  });
  const tx = {
    get: async (ref: { __filters?: [string, unknown][]; __c: string; get?: () => Promise<unknown> }) => {
      if (ref.__filters !== undefined) return runQuery(ref.__c, ref.__filters);
      return (ref as { get: () => Promise<unknown> }).get();
    },
    set: (ref: Ref, d: Data, o?: { merge?: boolean }) => mutate.set(ref.__c, ref.id, d, o?.merge),
    create: (ref: Ref, d: Data) => mutate.create(ref.__c, ref.id, d),
    delete: (ref: Ref) => mutate.delete(ref.__c, ref.id),
  };
  return {
    collection: (name: string) => ({
      doc: (id?: string) => docRef(name, id),
      where: (f: string, _op: string, v: unknown) => query(name, [[f, v]]),
    }),
    runTransaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
    __store: store,
  };
}

let db: ReturnType<typeof makeDb>;
const SEASON = "s1";
const DATE = "2026-07-04";
const MONTH = "2026-07";

beforeEach(() => {
  db = makeDb();
  (getDb as jest.Mock).mockReturnValue(db);
  const sched = jest.requireMock("@/lib/pokerSchedule");
  sched.isScheduledPokerDate.mockResolvedValue(true);
});

function seedPaid(uid: string, i: number, orderId: string | null = `ord-${uid}`) {
  const c = db.__store.get("pokerEntries") ?? new Map();
  db.__store.set("pokerEntries", c);
  c.set(`${SEASON}_${DATE}_${uid}`, {
    seasonId: SEASON, eventDate: DATE, lineUserId: uid, displayName: uid.toUpperCase(),
    status: "paid", paymentStatus: "paid", paymentTransactionId: orderId,
    paymentAmount: 1000, enteredAt: `2026-07-04T09:0${i}:00.000Z`,
  });
}
const day = () => db.__store.get("pokerDayState")?.get(`${SEASON}_${DATE}`) as PokerDayState | undefined;
const lastGame = () => day()!.games[day()!.games.length - 1];
const scoresFor = (uid: string) => db.__store.get("scores")?.get(`poker-${SEASON}-${DATE}-${uid}`) as Data | undefined;

/** a,b,c を paid にし、a をディーラーにして game1 を開始（a,b,c 全員がプレイヤー。ディーラーも入力する）。 */
async function startGame1() {
  ["a", "b", "c"].forEach((u, i) => seedPaid(u, i));
  await assignPokerDealer(SEASON, DATE, "a");
  await startPokerGame(SEASON, DATE, "a");
}
/** 現在の試合の開始時刻を「今から ms 前」に書き換える（30分経過の再現）。 */
const startedAgo = (ms: number) => { lastGame().startedAt = new Date(Date.now() - ms).toISOString(); };
const MIN30 = 30 * 60_000;

describe("effectivePokerGameStatus", () => {
  const start = "2026-07-04T04:00:00.000Z";
  const t0 = Date.parse(start);
  const game = (status: "ready" | "playing" | "reporting" | "confirmed") =>
    ({ gameIndex: 1, dealerId: "a", status, startedAt: start, reports: {} });
  test("ちょうど30分で reporting になる", () => {
    expect(effectivePokerGameStatus(game("playing"), t0 + MIN30)).toBe("reporting");
  });
  test("29分59秒はまだ playing", () => {
    expect(effectivePokerGameStatus(game("playing"), t0 + MIN30 - 1000)).toBe("playing");
  });
  test("playing 以外と、開始時刻の無い試合はそのまま返す", () => {
    expect(effectivePokerGameStatus(game("ready"), t0 + MIN30 * 2)).toBe("ready");
    expect(effectivePokerGameStatus(game("confirmed"), t0 + MIN30 * 2)).toBe("confirmed");
    expect(effectivePokerGameStatus({ ...game("playing"), startedAt: null }, t0 + MIN30 * 2)).toBe("playing");
  });
});

describe("assignPokerDealer", () => {
  test("支払い済み参加者がディーラーになり dayState を作成（受付はまだ開いている）", async () => {
    ["a", "b", "c"].forEach((u, i) => seedPaid(u, i));
    const r = await assignPokerDealer(SEASON, DATE, "a");
    expect(r.ok).toBe(true);
    expect(day()?.entryClosedAt).toBeFalsy();
    expect(lastGame()).toMatchObject({ gameIndex: 1, dealerId: "a", status: "ready" });
  });

  test("未払い/非参加者はディーラーになれない（403）", async () => {
    ["a", "b", "c"].forEach((u, i) => seedPaid(u, i));
    const r = await assignPokerDealer(SEASON, DATE, "zzz");
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  test("参加者が3名未満なら作成できない（409）", async () => {
    ["a", "b"].forEach((u, i) => seedPaid(u, i));
    const r = await assignPokerDealer(SEASON, DATE, "a");
    expect(r).toMatchObject({ ok: false, status: 409 });
  });

  test("開始前(ready)はディーラーを差し替えできる", async () => {
    ["a", "b", "c"].forEach((u, i) => seedPaid(u, i));
    await assignPokerDealer(SEASON, DATE, "a");
    await assignPokerDealer(SEASON, DATE, "b");
    expect(day()?.games).toHaveLength(1);
    expect(lastGame().dealerId).toBe("b");
  });

  test("進行中(playing)は新しいディーラーを選べない（409）", async () => {
    await startGame1();
    const r = await assignPokerDealer(SEASON, DATE, "b");
    expect(r).toMatchObject({ ok: false, status: 409 });
  });
});

describe("startPokerGame", () => {
  test("最初の開始で participants 確定＋受付締切＋タイマー起点", async () => {
    ["a", "b", "c"].forEach((u, i) => seedPaid(u, i));
    await assignPokerDealer(SEASON, DATE, "a");
    const r = await startPokerGame(SEASON, DATE, "a");
    expect(r.ok).toBe(true);
    expect(day()?.entryClosedAt).toBeTruthy();
    expect(day()?.participants.map((p) => p.lineUserId).sort()).toEqual(["a", "b", "c"]);
    expect(lastGame()).toMatchObject({ status: "playing" });
    expect(lastGame().startedAt).toBeTruthy();
  });

  test("ディーラー以外は開始できない（403）", async () => {
    ["a", "b", "c"].forEach((u, i) => seedPaid(u, i));
    await assignPokerDealer(SEASON, DATE, "a");
    const r = await startPokerGame(SEASON, DATE, "b");
    expect(r).toMatchObject({ ok: false, status: 403 });
  });
});

describe("endPokerGame / reportPokerChips", () => {
  test("ディーラーが終了→プレイヤーが自己申告", async () => {
    await startGame1();
    expect((await endPokerGame(SEASON, DATE, "a")).ok).toBe(true);
    expect(lastGame().status).toBe("reporting");
    expect((await reportPokerChips(SEASON, DATE, "b", 15000, {})).ok).toBe(true);
    expect(lastGame().reports.b.chips).toBe(15000);
  });

  test("ディーラー(a)も自分のチップを申告できる", async () => {
    await startGame1();
    await endPokerGame(SEASON, DATE, "a");
    const r = await reportPokerChips(SEASON, DATE, "a", 100, {});
    expect(r.ok).toBe(true);
    expect(lastGame().reports.a.chips).toBe(100);
  });

  test("ディーラーは代理入力できる／非ディーラーの代理は拒否", async () => {
    await startGame1();
    await endPokerGame(SEASON, DATE, "a");
    expect((await reportPokerChips(SEASON, DATE, "a", 5000, { targetUserId: "b" })).ok).toBe(true);
    expect(lastGame().reports.b.chips).toBe(5000);
    const r = await reportPokerChips(SEASON, DATE, "b", 100, { targetUserId: "c" });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  test("チップは0〜(初期×人数)の範囲外を拒否", async () => {
    await startGame1();
    await endPokerGame(SEASON, DATE, "a");
    // ディーラーも数えて3名 → 上限 30000
    expect((await reportPokerChips(SEASON, DATE, "b", 30000, {})).ok).toBe(true);
    const r = await reportPokerChips(SEASON, DATE, "b", 30001, {});
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  test("playing 中（終了前・30分たつ前）は申告できない（409）", async () => {
    await startGame1();
    startedAgo(MIN30 - 60_000);
    const r = await reportPokerChips(SEASON, DATE, "b", 100, {});
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(lastGame().status).toBe("playing");
  });

  test("30分を過ぎた playing へ申告すると、reporting に切り替えて受け付ける", async () => {
    await startGame1();
    startedAgo(MIN30 + 1000);
    const startedAt = lastGame().startedAt!;
    const r = await reportPokerChips(SEASON, DATE, "b", 100, {});
    expect(r.ok).toBe(true);
    expect(lastGame().status).toBe("reporting");
    expect(lastGame().endedAt).toBe(new Date(Date.parse(startedAt) + MIN30).toISOString());
    expect(lastGame().reports.b.chips).toBe(100);
  });

  test("30分で自動に切り替わった後にディーラーが「ゲーム終了」を押しても失敗にしない（already）", async () => {
    await startGame1();
    await endPokerGame(SEASON, DATE, "a");
    expect(await endPokerGame(SEASON, DATE, "a")).toMatchObject({ ok: true, already: true });
  });

  test("reporting でもディーラー以外の「ゲーム終了」は 403（already を返さない）", async () => {
    await startGame1();
    await endPokerGame(SEASON, DATE, "a");
    expect(await endPokerGame(SEASON, DATE, "b")).toMatchObject({ ok: false, status: 403 });
  });

  test("30分を過ぎた playing で「ゲーム終了」を押すと、endedAt は開始＋30分になる", async () => {
    await startGame1();
    startedAgo(MIN30 + 5 * 60_000);
    const startedAt = lastGame().startedAt!;
    expect((await endPokerGame(SEASON, DATE, "a")).ok).toBe(true);
    expect(lastGame().status).toBe("reporting");
    expect(lastGame().endedAt).toBe(new Date(Date.parse(startedAt) + MIN30).toISOString());
  });
});

describe("confirmPokerGame", () => {
  async function reported() {
    await startGame1();
    await endPokerGame(SEASON, DATE, "a");
    await reportPokerChips(SEASON, DATE, "a", 10000, {});
    await reportPokerChips(SEASON, DATE, "b", 15000, {});
    await reportPokerChips(SEASON, DATE, "c", 5000, {});
  }
  test("全員申告後にディーラーが確定→当日 scores を書く（ディーラーの分も）", async () => {
    await reported();
    const r = await confirmPokerGame(SEASON, DATE, "a");
    expect(r.ok).toBe(true);
    expect(lastGame().status).toBe("confirmed");
    expect(day()?.finishedAt).toBeFalsy();
    // b=15000(1位) / a=10000(2位・ディーラー) / c=5000(3位)。
    expect(scoresFor("b")).toMatchObject({ totalScore: 15000, gameCategory: "poker" });
    expect((scoresFor("b")!.details as Data).dayRank).toBe(1);
    expect(scoresFor("c")!.totalScore).toBe(5000);
    expect(scoresFor("a")).toMatchObject({ totalScore: 10000 });
    expect((scoresFor("a")!.details as Data).dayRank).toBe(2);
    expect(db.__store.get("games")?.get(`poker-${SEASON}-${DATE}`)).toMatchObject({ scoreRegistered: true });
  });

  test("未申告が残る間は確定できない（409）", async () => {
    await startGame1();
    await endPokerGame(SEASON, DATE, "a");
    await reportPokerChips(SEASON, DATE, "b", 15000, {});
    const r = await confirmPokerGame(SEASON, DATE, "a");
    expect(r).toMatchObject({ ok: false, status: 409 });
  });

  test("ディーラー本人の申告が無いと確定できない（409）", async () => {
    await startGame1();
    await endPokerGame(SEASON, DATE, "a");
    await reportPokerChips(SEASON, DATE, "b", 15000, {});
    await reportPokerChips(SEASON, DATE, "c", 5000, {});
    const r = await confirmPokerGame(SEASON, DATE, "a");
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(lastGame().status).toBe("reporting");
  });

  test("30分を過ぎた playing は、終了を押さなくても全員の申告後に確定できる", async () => {
    await startGame1();
    startedAgo(MIN30 + 1000);
    await reportPokerChips(SEASON, DATE, "a", 10000, {});
    await reportPokerChips(SEASON, DATE, "b", 15000, {});
    await reportPokerChips(SEASON, DATE, "c", 5000, {});
    expect((await confirmPokerGame(SEASON, DATE, "a")).ok).toBe(true);
    expect(lastGame().status).toBe("confirmed");
  });

  test("30分たつ前の playing は確定できない（409）", async () => {
    await startGame1();
    expect(await confirmPokerGame(SEASON, DATE, "a")).toMatchObject({ ok: false, status: 409 });
  });

  test("ディーラー以外は確定できない（403）", async () => {
    await reported();
    const r = await confirmPokerGame(SEASON, DATE, "b");
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  test("確定済みは冪等（already）", async () => {
    await reported();
    await confirmPokerGame(SEASON, DATE, "a");
    const r2 = await confirmPokerGame(SEASON, DATE, "a");
    expect(r2).toMatchObject({ ok: true, already: true });
  });

  test("次の試合: 別のディーラーで2試合目を追加→チップ合算", async () => {
    await reported();
    await confirmPokerGame(SEASON, DATE, "a"); // 試合1: a=10000, b=15000, c=5000
    // 試合2: b がディーラー（b も入力する）。
    expect((await assignPokerDealer(SEASON, DATE, "b")).ok).toBe(true);
    await startPokerGame(SEASON, DATE, "b");
    await endPokerGame(SEASON, DATE, "b");
    await reportPokerChips(SEASON, DATE, "a", 12000, {});
    await reportPokerChips(SEASON, DATE, "b", 10000, {});
    await reportPokerChips(SEASON, DATE, "c", 8000, {});
    await confirmPokerGame(SEASON, DATE, "b");
    expect(scoresFor("b")!.totalScore).toBe(25000);
    expect(scoresFor("c")!.totalScore).toBe(13000);
    expect(scoresFor("a")!.totalScore).toBe(22000);
  });

  describe("本日終了（finishDay）", () => {
    test("確定と同時に finishedAt / finishedBy を書く", async () => {
      await reported();
      const r = await confirmPokerGame(SEASON, DATE, "a", { finishDay: true });
      expect(r.ok).toBe(true);
      expect(lastGame().status).toBe("confirmed");
      expect(day()?.finishedAt).toBeTruthy();
      expect(day()?.finishedBy).toBe("a");
      expect(scoresFor("b")!.totalScore).toBe(15000);
    });

    test("「次の試合へ」で確定した後でも、同じディーラーなら本日終了だけを書ける", async () => {
      await reported();
      await confirmPokerGame(SEASON, DATE, "a");
      const r = await confirmPokerGame(SEASON, DATE, "a", { finishDay: true });
      expect(r.ok).toBe(true);
      expect(day()?.finishedAt).toBeTruthy();
      expect(day()?.finishedBy).toBe("a");
    });

    test("確定済みの試合のディーラー以外は本日終了にできない（403）", async () => {
      await reported();
      await confirmPokerGame(SEASON, DATE, "a");
      const r = await confirmPokerGame(SEASON, DATE, "b", { finishDay: true });
      expect(r).toMatchObject({ ok: false, status: 403 });
      expect(day()?.finishedAt).toBeFalsy();
    });

    test("未申告が残っていれば finishDay でも確定も終了もしない（409）", async () => {
      await startGame1();
      await endPokerGame(SEASON, DATE, "a");
      const r = await confirmPokerGame(SEASON, DATE, "a", { finishDay: true });
      expect(r).toMatchObject({ ok: false, status: 409 });
      expect(day()?.finishedAt).toBeFalsy();
    });

    describe("次の試合が ready のとき", () => {
      /** 試合1を a が確定 → b が次のディーラーに名乗り出た（ready）。 */
      async function nextReady() {
        await reported();
        await confirmPokerGame(SEASON, DATE, "a");
        await assignPokerDealer(SEASON, DATE, "b");
        expect(lastGame()).toMatchObject({ gameIndex: 2, status: "ready", dealerId: "b" });
      }

      test("ready の試合のディーラーは本日終了にでき、ready の試合は消える", async () => {
        await nextReady();
        const r = await confirmPokerGame(SEASON, DATE, "b", { finishDay: true });
        expect(r.ok).toBe(true);
        expect(day()?.finishedAt).toBeTruthy();
        expect(day()?.finishedBy).toBe("b");
        expect(day()?.games).toHaveLength(1);
        expect(lastGame()).toMatchObject({ gameIndex: 1, status: "confirmed" });
        // scores は確定時のまま（書き直さない）。
        expect(scoresFor("b")).toMatchObject({ totalScore: 15000, recordedBy: "dealer:a" });
      });

      test("直前に確定した試合のディーラーも本日終了にできる", async () => {
        await nextReady();
        const r = await confirmPokerGame(SEASON, DATE, "a", { finishDay: true });
        expect(r.ok).toBe(true);
        expect(day()?.finishedBy).toBe("a");
        expect(day()?.games).toHaveLength(1);
      });

      test("どちらのディーラーでもない人は 403（ready の試合も残る）", async () => {
        await nextReady();
        const r = await confirmPokerGame(SEASON, DATE, "c", { finishDay: true });
        expect(r).toMatchObject({ ok: false, status: 403 });
        expect(day()?.finishedAt).toBeFalsy();
        expect(day()?.games).toHaveLength(2);
      });

      test("確定済みの試合が1つも無い日（最初の試合が ready）は 409", async () => {
        ["a", "b", "c"].forEach((u, i) => seedPaid(u, i));
        await assignPokerDealer(SEASON, DATE, "a");
        const r = await confirmPokerGame(SEASON, DATE, "a", { finishDay: true });
        expect(r).toMatchObject({ ok: false, status: 409 });
        expect(day()?.finishedAt).toBeFalsy();
        expect(day()?.games).toHaveLength(1);
      });

      test("finishDay なしの確定は、ready の試合には従来どおり 409", async () => {
        await nextReady();
        expect(await confirmPokerGame(SEASON, DATE, "b")).toMatchObject({ ok: false, status: 409 });
        expect(day()?.games).toHaveLength(2);
      });
    });

    test("本日終了後はどの操作も 409", async () => {
      await reported();
      await confirmPokerGame(SEASON, DATE, "a", { finishDay: true });
      expect(await assignPokerDealer(SEASON, DATE, "b")).toMatchObject({ ok: false, status: 409 });
      expect(await startPokerGame(SEASON, DATE, "a")).toMatchObject({ ok: false, status: 409 });
      expect(await endPokerGame(SEASON, DATE, "a")).toMatchObject({ ok: false, status: 409 });
      expect(await reportPokerChips(SEASON, DATE, "b", 1, {})).toMatchObject({ ok: false, status: 409 });
      expect(await confirmPokerGame(SEASON, DATE, "a", { finishDay: true })).toMatchObject({ ok: false, status: 409 });
    });
  });
});

describe("pokerDayResults（GET の results）", () => {
  test("確定済みの試合が無ければ空", async () => {
    await startGame1();
    expect(pokerDayResults(day()!, "a")).toEqual([]);
  });

  test("順位の昇順で、試合ごとのチップを持ち、lineUserId は入れない", async () => {
    await startGame1();
    await endPokerGame(SEASON, DATE, "a");
    await reportPokerChips(SEASON, DATE, "a", 10000, {});
    await reportPokerChips(SEASON, DATE, "b", 15000, {});
    await reportPokerChips(SEASON, DATE, "c", 5000, {});
    await confirmPokerGame(SEASON, DATE, "a");
    const results = pokerDayResults(day()!, "a");
    expect(results).toEqual([
      { displayName: "B", pictureUrl: "", isMe: false, totalChips: 15000, rank: 1, games: [{ gameIndex: 1, chips: 15000 }] },
      { displayName: "A", pictureUrl: "", isMe: true, totalChips: 10000, rank: 2, games: [{ gameIndex: 1, chips: 10000 }] },
      { displayName: "C", pictureUrl: "", isMe: false, totalChips: 5000, rank: 3, games: [{ gameIndex: 1, chips: 5000 }] },
    ]);
    expect(JSON.stringify(results)).not.toContain("lineUserId");
  });
});

describe("cancelPokerDay（管理者中止）", () => {
  test("受付前でも支払い済みは返金対象・dayState破棄・通知・中止doc", async () => {
    ["a", "b", "c"].forEach((u, i) => seedPaid(u, i));
    await assignPokerDealer(SEASON, DATE, "a");
    db.__store.set("pokerMonthlyLocks", new Map([[`${SEASON}_a_${MONTH}`, { eventDate: DATE }]]));
    const r = await cancelPokerDay(SEASON, DATE, "admin:x");
    expect(r).toMatchObject({ status: "forfeited", paidCount: 3, refundCount: 3 });
    expect(db.__store.get("pokerEntries")!.get(`${SEASON}_${DATE}_a`)!.status).toBe("cancelRequested");
    expect(db.__store.get("pokerMonthlyLocks")!.has(`${SEASON}_a_${MONTH}`)).toBe(false);
    expect(day()).toBeUndefined();
    expect(db.__store.get("pokerCancelledDates")!.has(DATE)).toBe(true);
    const notifs = Array.from((db.__store.get("adminNotifications") ?? new Map()).values());
    expect(notifs.some((n) => (n as Data).type === "poker_event_forfeit")).toBe(true);
  });

  test("確定済みの試合があると中止できない（finished）", async () => {
    await startGame1();
    await endPokerGame(SEASON, DATE, "a");
    await reportPokerChips(SEASON, DATE, "a", 10000, {});
    await reportPokerChips(SEASON, DATE, "b", 15000, {});
    await reportPokerChips(SEASON, DATE, "c", 5000, {});
    await confirmPokerGame(SEASON, DATE, "a");
    const r = await cancelPokerDay(SEASON, DATE, "admin:x");
    expect(r).toEqual({ status: "finished" });
  });

  test("二重中止は冪等（already）", async () => {
    ["a", "b", "c"].forEach((u, i) => seedPaid(u, i));
    await cancelPokerDay(SEASON, DATE, "admin:x");
    const r2 = await cancelPokerDay(SEASON, DATE, "admin:x");
    expect(r2).toEqual({ status: "already" });
  });
});
