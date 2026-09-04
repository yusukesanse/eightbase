/**
 * 単体テスト: 麻雀の当日GM（src/lib/mahjongDayGm.ts）
 *
 * 背景（2026-09-04）: シーズン登録GM（Season.gameMasterIds）が2名以上同じ日に参加すると、
 * 全員に GM パネルが出て「想定していない人が進行してしまう」事故が起きた。
 *
 * 固定する仕様:
 *  - 資格者 = 登録GM ∩ その日の参加表明者（cancelRequested / refunded は除く）
 *  - 資格者が1名だけ → その人が暗黙に当日GM（追加操作なし）
 *  - 資格者が2名以上 → 「GMをやる」で決めるまで誰も進行できない（needsClaim）
 *  - 資格者が0名 → 誰も進行できない（登録GMでも参加していなければ不可）
 *  - 決まった後はその人だけ isGm。他の資格者は交代（takeover）できる。資格者以外は交代できない
 *  - 本日終了後は交代できない
 */
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));

import { getDb } from "@/lib/firebaseAdmin";
import {
  eligibleMahjongDayGms,
  resolveMahjongDayGmAccess,
  claimMahjongDayGm,
  getMahjongDayGmAccess,
  MAHJONG_DAY_GM_COLLECTION,
} from "@/lib/mahjongDayGm";

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
      set: (ref: ReturnType<typeof docRef>, d: Data, opt?: { merge?: boolean }) => void;
    }) => Promise<T>): Promise<T> =>
      fn({
        get: (ref) => ref.get(),
        set: (ref, d, opt) => {
          const cur = opt?.merge ? (col(ref.__c).get(ref.id) ?? {}) : {};
          col(ref.__c).set(ref.id, { ...cur, ...d });
        },
      }),
  };
}

const SEASON_ID = "season-1";
const DATE = "2026-09-05";
const season = { seasonId: SEASON_ID, gameMasterIds: ["U-gm1", "U-gm2", "U-gm3"] };
type EntryData = Data & { lineUserId: string; displayName: string; enteredAt: string; status?: string; paymentStatus?: string };
const entry = (id: string, fields: Data = {}): EntryData => ({
  seasonId: SEASON_ID, eventDate: DATE, lineUserId: id, displayName: `name-${id}`,
  enteredAt: `2026-09-01T00:00:00.00${id.slice(-1)}Z`, status: "paid", ...fields,
});

describe("eligibleMahjongDayGms（資格者）", () => {
  test("登録GM ∩ 参加表明者。キャンセル依頼中・返金済みは除く。enteredAt 昇順", () => {
    const list = eligibleMahjongDayGms(season, [
      entry("U-gm2"),
      entry("U-gm1", { status: "reserved" }), // 未払いでも参加表明していれば資格あり
      entry("U-gm3", { status: "cancelRequested", paymentStatus: "cancelRequested" }),
      entry("U-m1"), // 登録GMではない
    ]);
    expect(list.map((c) => c.lineUserId)).toEqual(["U-gm1", "U-gm2"]);
    expect(list[0].displayName).toBe("name-U-gm1");
  });

  test("gameMasterIds が無いシーズンは資格者なし", () => {
    expect(eligibleMahjongDayGms({ seasonId: SEASON_ID }, [entry("U-gm1")])).toEqual([]);
  });
});

describe("resolveMahjongDayGmAccess（判定）", () => {
  test("資格者が1名だけなら暗黙にその人が当日GM", () => {
    const a = resolveMahjongDayGmAccess(season, null, [entry("U-gm1"), entry("U-m1")], "U-gm1");
    expect(a).toMatchObject({ registered: true, eligible: true, isGm: true, implicit: true, needsClaim: false, gmUserId: null });
    // 参加していない登録GMは操作できない
    const b = resolveMahjongDayGmAccess(season, null, [entry("U-gm1")], "U-gm2");
    expect(b).toMatchObject({ registered: true, eligible: false, isGm: false });
  });

  test("資格者が2名以上・未決定なら誰も isGm にならず needsClaim", () => {
    const entries = [entry("U-gm1"), entry("U-gm2")];
    for (const u of ["U-gm1", "U-gm2"]) {
      const a = resolveMahjongDayGmAccess(season, null, entries, u);
      expect(a).toMatchObject({ eligible: true, isGm: false, implicit: false, needsClaim: true });
      expect(a.candidates.map((c) => c.lineUserId)).toEqual(["U-gm1", "U-gm2"]);
    }
  });

  test("決定後はその人だけ isGm。他の資格者は eligible のまま（交代候補）", () => {
    const entries = [entry("U-gm1"), entry("U-gm2")];
    const gm = { gmUserId: "U-gm2", gmDisplayName: "name-U-gm2" };
    expect(resolveMahjongDayGmAccess(season, gm, entries, "U-gm2")).toMatchObject({ isGm: true, needsClaim: false, gmUserId: "U-gm2" });
    expect(resolveMahjongDayGmAccess(season, gm, entries, "U-gm1")).toMatchObject({ isGm: false, eligible: true, needsClaim: false, gmDisplayName: "name-U-gm2" });
  });

  test("資格者0名（登録GMが誰も参加していない）は誰も操作できない", () => {
    const a = resolveMahjongDayGmAccess(season, null, [entry("U-m1"), entry("U-m2")], "U-gm1");
    expect(a).toMatchObject({ registered: true, eligible: false, isGm: false, needsClaim: false, candidates: [] });
  });

  test("登録GMでない人は決定済みでも isGm にならない（gm doc の値を信用しない）", () => {
    const gm = { gmUserId: "U-m1", gmDisplayName: "x" };
    expect(resolveMahjongDayGmAccess(season, gm, [entry("U-m1")], "U-m1")).toMatchObject({ registered: false, isGm: false });
  });
});

describe("claimMahjongDayGm（GMをやる／交代）", () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(() => {
    db = makeDb();
    (getDb as jest.Mock).mockReturnValue(db);
  });

  test("資格者が名乗り出ると当日GMになり、他の資格者は交代できる", async () => {
    db.__seed("mahjongEntries", "e1", entry("U-gm1"));
    db.__seed("mahjongEntries", "e2", entry("U-gm2"));

    const r1 = await claimMahjongDayGm(season, DATE, "U-gm1");
    expect(r1).toEqual({ ok: true, already: false, takeoverFrom: null });
    expect(db.__get(MAHJONG_DAY_GM_COLLECTION, `${SEASON_ID}_${DATE}`)).toMatchObject({
      seasonId: SEASON_ID, eventDate: DATE, gmUserId: "U-gm1", gmDisplayName: "name-U-gm1",
    });

    // 冪等
    expect(await claimMahjongDayGm(season, DATE, "U-gm1")).toEqual({ ok: true, already: true, takeoverFrom: null });

    // 交代
    const r2 = await claimMahjongDayGm(season, DATE, "U-gm2");
    expect(r2).toEqual({ ok: true, already: false, takeoverFrom: "U-gm1" });
    const access = await getMahjongDayGmAccess(season, DATE, "U-gm2");
    expect(access).toMatchObject({ isGm: true, gmUserId: "U-gm2" });
  });

  test("資格者でない人（登録GMでない／参加していない）は 403", async () => {
    db.__seed("mahjongEntries", "e1", entry("U-gm1"));
    db.__seed("mahjongEntries", "e3", entry("U-m1"));
    expect(await claimMahjongDayGm(season, DATE, "U-m1")).toMatchObject({ ok: false, status: 403 });
    expect(await claimMahjongDayGm(season, DATE, "U-gm2")).toMatchObject({ ok: false, status: 403 });
    expect(db.__get(MAHJONG_DAY_GM_COLLECTION, `${SEASON_ID}_${DATE}`)).toBeUndefined();
  });

  test("本日終了後は交代できない（409）", async () => {
    db.__seed("mahjongEntries", "e1", entry("U-gm1"));
    db.__seed("mahjongEntries", "e2", entry("U-gm2"));
    db.__seed(MAHJONG_DAY_GM_COLLECTION, `${SEASON_ID}_${DATE}`, { seasonId: SEASON_ID, eventDate: DATE, gmUserId: "U-gm1", gmDisplayName: "a" });
    db.__seed("mahjongDayState", `${SEASON_ID}_${DATE}`, { seasonId: SEASON_ID, eventDate: DATE, round: 3, finishedAt: "2026-09-05T12:00:00Z" });
    expect(await claimMahjongDayGm(season, DATE, "U-gm2")).toMatchObject({ ok: false, status: 409 });
    expect(db.__get(MAHJONG_DAY_GM_COLLECTION, `${SEASON_ID}_${DATE}`)!.gmUserId).toBe("U-gm1");
  });

  test("getMahjongDayGmAccess: 登録GMでない人は entries を読まずに not registered", async () => {
    const a = await getMahjongDayGmAccess(season, DATE, "U-m1");
    expect(a).toMatchObject({ registered: false, eligible: false, isGm: false, candidates: [] });
  });
});

describe("想定外のデータ・入力（壊れていても 500 にせず安全側に倒す）", () => {
  test("gameMasterIds が配列でない／null シーズンでも例外を投げず『資格なし』", () => {
    const broken = { seasonId: SEASON_ID, gameMasterIds: "U-gm1" as unknown };
    expect(resolveMahjongDayGmAccess(broken, null, [entry("U-gm1")], "U-gm1")).toMatchObject({ registered: false, isGm: false, candidates: [] });
    expect(resolveMahjongDayGmAccess(null, null, [entry("U-gm1")], "U-gm1")).toMatchObject({ registered: false, isGm: false });
    expect(resolveMahjongDayGmAccess(undefined, { gmUserId: "U-gm1" }, [], "U-gm1")).toMatchObject({ isGm: false });
  });

  test("enteredAt / displayName が欠けた entry でも並び替え・表示名で落ちない", () => {
    const list = eligibleMahjongDayGms(season, [
      { lineUserId: "U-gm2", displayName: "", enteredAt: undefined as unknown as string, status: "paid" },
      entry("U-gm1"),
    ]);
    expect(list.map((c) => c.lineUserId)).toEqual(["U-gm2", "U-gm1"]);
    expect(list[0].displayName).toBe("ユーザー");
  });

  test("status が未知の文字列（例: 'pending'）は paymentStatus にフォールバックし、pending は参加者として数えない扱いにはならない（reserved 扱い）", () => {
    // deriveStatus: 未知の status は無視 → paymentStatus 'pending' → reserved（参加表明はしている）
    const a = resolveMahjongDayGmAccess(season, null, [{ ...entry("U-gm1"), status: "weird", paymentStatus: "pending" }], "U-gm1");
    expect(a).toMatchObject({ eligible: true, isGm: true, implicit: true });
  });

  test("当日GMに記録された人が GM 登録を外されていたら無視し、残る資格者1名が暗黙GMになる", () => {
    const gm = { gmUserId: "U-ex-gm", gmDisplayName: "元GM" };
    const a = resolveMahjongDayGmAccess(season, gm, [entry("U-gm1"), entry("U-ex-gm")], "U-gm1");
    expect(a).toMatchObject({ isGm: true, implicit: true, gmUserId: null, gmDisplayName: null });
  });

  test("当日GMに記録された人が参加をキャンセルしていたら当日GMを失う（資格者2名なら再度 needsClaim）", () => {
    const gm = { gmUserId: "U-gm1", gmDisplayName: "a" };
    const entries = [
      entry("U-gm1", { status: "cancelRequested", paymentStatus: "cancelRequested" }),
      entry("U-gm2"),
      entry("U-gm3"),
    ];
    expect(resolveMahjongDayGmAccess(season, gm, entries, "U-gm1")).toMatchObject({ isGm: false, eligible: false });
    expect(resolveMahjongDayGmAccess(season, gm, entries, "U-gm2")).toMatchObject({ isGm: false, needsClaim: true, gmUserId: null });
  });

  test("gm doc に gmUserId が無い（壊れた doc）→ 未決定として扱う", () => {
    const a = resolveMahjongDayGmAccess(season, { gmDisplayName: "x" }, [entry("U-gm1"), entry("U-gm2")], "U-gm1");
    expect(a).toMatchObject({ isGm: false, needsClaim: true });
  });

  test("Firestore 障害（getDb が throw）は握りつぶさず reject する（ルートが 500 にする）", async () => {
    (getDb as jest.Mock).mockImplementation(() => { throw new Error("RESOURCE_EXHAUSTED"); });
    await expect(claimMahjongDayGm(season, DATE, "U-gm1")).rejects.toThrow("RESOURCE_EXHAUSTED");
    await expect(getMahjongDayGmAccess(season, DATE, "U-gm1")).rejects.toThrow("RESOURCE_EXHAUSTED");
    // 登録GMでない人は DB に触らないので障害中でも判定できる
    await expect(getMahjongDayGmAccess(season, DATE, "U-m1")).resolves.toMatchObject({ registered: false });
  });

  test("claim: シーズン null は 403、参加者ゼロの日も 403（何も書かない）", async () => {
    const db = makeDb();
    (getDb as jest.Mock).mockReturnValue(db);
    expect(await claimMahjongDayGm(null, DATE, "U-gm1")).toMatchObject({ ok: false, status: 403 });
    expect(await claimMahjongDayGm(season, DATE, "U-gm1")).toMatchObject({ ok: false, status: 403 });
    expect(db.__get(MAHJONG_DAY_GM_COLLECTION, `${SEASON_ID}_${DATE}`)).toBeUndefined();
  });
});
