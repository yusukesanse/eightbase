jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/auth", () => ({ requireGameUser: jest.fn() }));
jest.mock("@/lib/mahjong", () => {
  const actual = jest.requireActual("@/lib/mahjong");
  return {
    ...actual,
    getActiveSeason: jest.fn(),
    isGameMaster: actual.isGameMaster,
    isManualAssignmentSeason: actual.isManualAssignmentSeason,
    toPublicMahjongTable: actual.toPublicMahjongTable,
  };
});
jest.mock("@/lib/auditLog", () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/dev-only/mahjongDemo", () => ({
  advanceDemoDay: jest.fn(),
  reportOneDemoDummy: jest.fn(),
}));

import type { NextRequest } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { writeAuditLog } from "@/lib/auditLog";
import {
  claimMahjongDayGm,
  MAHJONG_DAY_GM_COLLECTION,
  MAHJONG_DAY_GM_REQUIRED_MESSAGE,
} from "@/lib/mahjongDayGm";
import { POST as claimGm } from "@/app/api/mahjong/day/gm/route";
import { POST as startDay } from "@/app/api/mahjong/day/start/route";
import { GET as getDay } from "@/app/api/mahjong/day/route";

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
      update: (ref: ReturnType<typeof docRef>, d: Data) => void;
    }) => Promise<T>): Promise<T> =>
      fn({
        get: (ref) => ref.get(),
        set: (ref, d, opt) => {
          const cur = opt?.merge ? (col(ref.__c).get(ref.id) ?? {}) : {};
          col(ref.__c).set(ref.id, { ...cur, ...d });
        },
        update: (ref, d) => {
          const cur = col(ref.__c).get(ref.id) ?? {};
          col(ref.__c).set(ref.id, { ...cur, ...d });
        },
      }),
  };
}

const SEASON_ID = "season-1";
const DATE = "2099-09-05";
const GM_1 = "U-gm1";
const GM_2 = "U-gm2";
const MEMBER_1 = "U-member1";
const MEMBER_2 = "U-member2";

const season = (gameMasterIds: string[] = [GM_1, GM_2]) => ({
  seasonId: SEASON_ID,
  gameMasterIds,
});

function paidEntry(lineUserId: string, index: number): Data {
  return {
    seasonId: SEASON_ID,
    eventDate: DATE,
    lineUserId,
    displayName: `参加者${index}`,
    enteredAt: `2099-09-01T00:00:0${index}.000Z`,
    status: "paid",
    paymentStatus: "paid",
  };
}

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function getReq(params: Record<string, string>): NextRequest {
  const url = new URL("http://localhost/api/mahjong/day");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return { nextUrl: url } as unknown as NextRequest;
}

let db: ReturnType<typeof makeDb>;

beforeEach(() => {
  db = makeDb();
  (getDb as jest.Mock).mockReturnValue(db);
  (getActiveSeason as jest.Mock).mockResolvedValue(season());
  (requireGameUser as jest.Mock).mockResolvedValue(GM_1);
  (writeAuditLog as jest.Mock).mockClear();
});

describe("POST /api/mahjong/day/gm", () => {
  test("参加している登録GMが名乗り出ると専用コレクションに記録する", async () => {
    db.__seed("mahjongEntries", "e-gm1", paidEntry(GM_1, 1));

    const res = await claimGm(req({ eventDate: DATE }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, already: false, takeoverFrom: null });
    expect(db.__get(MAHJONG_DAY_GM_COLLECTION, `${SEASON_ID}_${DATE}`)).toMatchObject({
      gmUserId: GM_1,
      gmDisplayName: "参加者1",
    });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "day.gm_claimed", gameCategory: "mahjong", actor: GM_1 })
    );
  });

  test("登録GMでもその日に参加していなければ403", async () => {
    db.__seed("mahjongEntries", "e-gm2", paidEntry(GM_2, 1));

    const res = await claimGm(req({ eventDate: DATE }));

    expect(res.status).toBe(403);
    expect(db.__get(MAHJONG_DAY_GM_COLLECTION, `${SEASON_ID}_${DATE}`)).toBeUndefined();
  });

  test("その日の参加者でも登録GMでなければ403", async () => {
    (requireGameUser as jest.Mock).mockResolvedValue(MEMBER_1);
    db.__seed("mahjongEntries", "e-member1", paidEntry(MEMBER_1, 1));

    const res = await claimGm(req({ eventDate: DATE }));

    expect(res.status).toBe(403);
    expect(db.__get(MAHJONG_DAY_GM_COLLECTION, `${SEASON_ID}_${DATE}`)).toBeUndefined();
  });
});

describe("POST /api/mahjong/day/start", () => {
  function seedFourWithTwoGms() {
    db.__seed("mahjongEntries", "e-gm1", paidEntry(GM_1, 1));
    db.__seed("mahjongEntries", "e-gm2", paidEntry(GM_2, 2));
    db.__seed("mahjongEntries", "e-member1", paidEntry(MEMBER_1, 3));
    db.__seed("mahjongEntries", "e-member2", paidEntry(MEMBER_2, 4));
  }

  test("登録GMが2名参加して未決定なら開始できない", async () => {
    seedFourWithTwoGms();

    const res = await startDay(req({ eventDate: DATE }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: MAHJONG_DAY_GM_REQUIRED_MESSAGE });
  });

  test("名乗り出たGMだけが開始でき、もう片方は拒否される", async () => {
    seedFourWithTwoGms();
    expect(await claimMahjongDayGm(season(), DATE, GM_1)).toMatchObject({ ok: true });

    const mine = await startDay(req({ eventDate: DATE }));
    expect(mine.status).toBe(200);
    expect(await mine.json()).toMatchObject({ success: true, already: false, paidCount: 4 });

    (requireGameUser as jest.Mock).mockResolvedValue(GM_2);
    const other = await startDay(req({ eventDate: DATE }));
    expect(other.status).toBe(403);
    expect(await other.json()).toEqual({ error: MAHJONG_DAY_GM_REQUIRED_MESSAGE });
  });

  test("参加する登録GMが1名だけなら開始時に暗黙GMを明示記録する", async () => {
    (getActiveSeason as jest.Mock).mockResolvedValue(season([GM_1]));
    db.__seed("mahjongEntries", "e-gm1", paidEntry(GM_1, 1));
    db.__seed("mahjongEntries", "e-member1", paidEntry(MEMBER_1, 2));
    db.__seed("mahjongEntries", "e-member2", paidEntry(MEMBER_2, 3));
    db.__seed("mahjongEntries", "e-member3", paidEntry("U-member3", 4));

    const res = await startDay(req({ eventDate: DATE }));

    expect(res.status).toBe(200);
    expect(db.__get(MAHJONG_DAY_GM_COLLECTION, `${SEASON_ID}_${DATE}`)).toMatchObject({ gmUserId: GM_1 });
  });
});

describe("GET /api/mahjong/day", () => {
  test("登録GMでない参加者にはGM権限を返さない", async () => {
    (requireGameUser as jest.Mock).mockResolvedValue(MEMBER_1);
    db.__seed("mahjongEntries", "e-member1", paidEntry(MEMBER_1, 1));

    const res = await getDay(getReq({ eventDate: DATE }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isGameMaster).toBe(false);
    expect(body.dayGm.eligible).toBe(false);
  });

  test("登録GMが2名参加して未決定なら候補者名だけを返す", async () => {
    db.__seed("mahjongEntries", "e-gm1", paidEntry(GM_1, 1));
    db.__seed("mahjongEntries", "e-gm2", paidEntry(GM_2, 2));

    const res = await getDay(getReq({ eventDate: DATE }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isGameMaster).toBe(false);
    expect(body.dayGm.needsClaim).toBe(true);
    expect(body.dayGm.candidates).toHaveLength(2);
    expect(body.dayGm.candidates).toEqual(["参加者1", "参加者2"]);
    expect(JSON.stringify(body.dayGm)).not.toContain(GM_1);
    expect(JSON.stringify(body.dayGm)).not.toContain(GM_2);
  });
});

/* ───────── 落ちるべきケース・想定外の入力／障害 ───────── */

import { POST as cancelDayRoute } from "@/app/api/mahjong/day/cancel/route";
import { POST as finishDayRoute } from "@/app/api/mahjong/day/finish/route";
import { DELETE as dropTableRoute } from "@/app/api/mahjong/day/table/route";
import { POST as assignRoute } from "@/app/api/mahjong/day/assign/route";
import { GET as assignmentRoute } from "@/app/api/mahjong/day/assignment/route";

function badJsonReq(): NextRequest {
  return { json: async () => { throw new SyntaxError("Unexpected token"); } } as unknown as NextRequest;
}

describe("入力・認証の異常系（Firestore に触らず弾く）", () => {
  test("未ログインは 401（gm / start / 当日GET）", async () => {
    (requireGameUser as jest.Mock).mockResolvedValue(null);
    expect((await claimGm(req({ eventDate: DATE }))).status).toBe(401);
    expect((await startDay(req({ eventDate: DATE }))).status).toBe(401);
    expect((await getDay(getReq({ eventDate: DATE }))).status).toBe(401);
  });

  test("アクティブシーズンが無ければ 400", async () => {
    (getActiveSeason as jest.Mock).mockResolvedValue(null);
    expect((await claimGm(req({ eventDate: DATE }))).status).toBe(400);
    expect((await startDay(req({ eventDate: DATE }))).status).toBe(400);
  });

  test.each([
    ["スラッシュ区切り", { eventDate: "2099/09/05" }],
    ["日付が数値", { eventDate: 20990905 }],
    ["eventDate 無し", {}],
    ["body が配列", []],
    ["body が null", null],
  ])("eventDate が不正（%s）は 400 で何も書かない", async (_label, body) => {
    db.__seed("mahjongEntries", "e-gm1", paidEntry(GM_1, 1));
    const res = await claimGm(req(body));
    expect(res.status).toBe(400);
    expect(db.__get(MAHJONG_DAY_GM_COLLECTION, `${SEASON_ID}_${DATE}`)).toBeUndefined();
    expect((await startDay(req(body))).status).toBe(400);
  });

  test("JSON として壊れた body は 400（500 にしない）", async () => {
    expect((await claimGm(badJsonReq())).status).toBe(400);
    expect((await startDay(badJsonReq())).status).toBe(400);
  });

  test("当日GET の eventDate 欠落／不正は 400", async () => {
    expect((await getDay(getReq({}))).status).toBe(400);
    expect((await getDay(getReq({ eventDate: "2099-9-5" }))).status).toBe(400);
  });
});

describe("Firestore 障害", () => {
  test("gm POST: 読み取りで例外 → 500・汎用メッセージ（内部エラー文を漏らさない）", async () => {
    (getDb as jest.Mock).mockImplementation(() => { throw new Error("RESOURCE_EXHAUSTED: quota"); });
    const res = await claimGm(req({ eventDate: DATE }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "ゲームマスターの登録に失敗しました" });
    expect(JSON.stringify(body)).not.toContain("RESOURCE_EXHAUSTED");
  });

  test("進行API: 認可判定の途中で Firestore が落ちたら 500（未処理の例外にしない・内部エラー文を漏らさない）", async () => {
    // 登録GMの判定は Firestore を読む。ここで落ちたときの挙動を 6本まとめて固定する。
    (getDb as jest.Mock).mockImplementation(() => { throw new Error("UNAVAILABLE"); });
    const results = await Promise.all([
      startDay(req({ eventDate: DATE })),
      cancelDayRoute(req({ eventDate: DATE })),
      finishDayRoute(req({ eventDate: DATE })),
      dropTableRoute(req({ eventDate: DATE, label: "A" })),
      assignRoute(req({ eventDate: DATE, tables: [], waiting: [] })),
      assignmentRoute(getReq({ eventDate: DATE })),
    ]);
    for (const res of results) {
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toEqual({ error: "ゲームマスターの確認に失敗しました" });
      expect(JSON.stringify(body)).not.toContain("UNAVAILABLE");
    }
  });

  test("start POST: 開始処理（startDay/startGameDay）で例外 → 500", async () => {
    (getActiveSeason as jest.Mock).mockResolvedValue(season([GM_1]));
    db.__seed("mahjongEntries", "e-gm1", paidEntry(GM_1, 1));
    // 認可の読み取りは成功させ、その後（開始処理）の getDb で落とす。
    let calls = 0;
    (getDb as jest.Mock).mockImplementation(() => {
      calls += 1;
      if (calls > 2) throw new Error("DEADLINE_EXCEEDED");
      return db;
    });
    const res = await startDay(req({ eventDate: DATE }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "ゲーム開始に失敗しました" });
  });
});

describe("認可の境界（進行API 全6本が当日GM以外を 403 にする）", () => {
  function seedTwoGmsUnclaimed() {
    db.__seed("mahjongEntries", "e-gm1", paidEntry(GM_1, 1));
    db.__seed("mahjongEntries", "e-gm2", paidEntry(GM_2, 2));
    db.__seed("mahjongEntries", "e-m1", paidEntry(MEMBER_1, 3));
    db.__seed("mahjongEntries", "e-m2", paidEntry(MEMBER_2, 4));
  }

  test("登録GM2名・未決定: cancel / finish / table / assign / assignment すべて 403", async () => {
    seedTwoGmsUnclaimed();
    const expect403 = async (res: Response) => {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: MAHJONG_DAY_GM_REQUIRED_MESSAGE });
    };
    await expect403(await cancelDayRoute(req({ eventDate: DATE })));
    await expect403(await finishDayRoute(req({ eventDate: DATE })));
    await expect403(await dropTableRoute(req({ eventDate: DATE, label: "A" })));
    await expect403(await assignRoute(req({ eventDate: DATE, tables: [], waiting: [] })));
    await expect403(await assignmentRoute(getReq({ eventDate: DATE })));
    // 何も書かれていない
    expect(db.__get("mahjongDayState", `${SEASON_ID}_${DATE}`)).toBeUndefined();
    expect(db.__get("mahjongCancelledDates", DATE)).toBeUndefined();
  });

  test("登録GMだが参加していない人は、GMが1名参加していても操作できない（暗黙GMは参加者側）", async () => {
    db.__seed("mahjongEntries", "e-gm2", paidEntry(GM_2, 1));
    db.__seed("mahjongEntries", "e-m1", paidEntry(MEMBER_1, 2));
    db.__seed("mahjongEntries", "e-m2", paidEntry(MEMBER_2, 3));
    db.__seed("mahjongEntries", "e-m3", paidEntry("U-member3", 4));
    // GM_1（不参加）で開始 → 403
    expect((await startDay(req({ eventDate: DATE }))).status).toBe(403);
    // GM_2（参加・唯一）で開始 → 200
    (requireGameUser as jest.Mock).mockResolvedValue(GM_2);
    expect((await startDay(req({ eventDate: DATE }))).status).toBe(200);
  });

  test("当日GMに決まった人が参加をキャンセルすると権限を失い、残る資格者が暗黙GMになる", async () => {
    seedTwoGmsUnclaimed();
    expect(await claimMahjongDayGm(season(), DATE, GM_1)).toMatchObject({ ok: true });
    // GM_1 が参加をキャンセル（キャンセル依頼中）
    db.__seed("mahjongEntries", "e-gm1", { ...paidEntry(GM_1, 1), status: "cancelRequested", paymentStatus: "cancelRequested" });
    expect((await startDay(req({ eventDate: DATE }))).status).toBe(403);
    (requireGameUser as jest.Mock).mockResolvedValue(GM_2);
    const body = await (await getDay(getReq({ eventDate: DATE }))).json();
    expect(body.isGameMaster).toBe(true);
    expect(body.dayGm).toMatchObject({ implicit: true, needsClaim: false, gmDisplayName: null });
  });

  test("本日終了後の交代は 409 で当日GMを上書きしない", async () => {
    seedTwoGmsUnclaimed();
    expect(await claimMahjongDayGm(season(), DATE, GM_1)).toMatchObject({ ok: true });
    db.__seed("mahjongDayState", `${SEASON_ID}_${DATE}`, { seasonId: SEASON_ID, eventDate: DATE, round: 3, entryClosedAt: "x", finishedAt: "2099-09-05T12:00:00Z" });
    (requireGameUser as jest.Mock).mockResolvedValue(GM_2);
    const res = await claimGm(req({ eventDate: DATE }));
    expect(res.status).toBe(409);
    expect(db.__get(MAHJONG_DAY_GM_COLLECTION, `${SEASON_ID}_${DATE}`)!.gmUserId).toBe(GM_1);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  test("交代は監査ログに前任者を残す", async () => {
    seedTwoGmsUnclaimed();
    expect(await claimMahjongDayGm(season(), DATE, GM_1)).toMatchObject({ ok: true });
    (requireGameUser as jest.Mock).mockResolvedValue(GM_2);
    const res = await claimGm(req({ eventDate: DATE }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, already: false, takeoverFrom: GM_1 });
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ actor: GM_2, meta: { takeoverFrom: GM_1 } }));
  });
});
