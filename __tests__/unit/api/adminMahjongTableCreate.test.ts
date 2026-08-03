/**
 * 単体テスト: POST /api/admin/mahjong/tables（管理者が卓を手入力で追加）
 *
 * 背景: 2026-08-01 はゲストが参加できない不具合でアプリに点数を入れられず紙運用になった。
 * 既存の管理APIは卓の「修正」と「削除」しか無く、**卓が無い日は何も入れられなかった**。
 *
 * 固定する仕様:
 *  - ちょうど4名・重複なし。参加表明の有無は問わない（ゲストも選べる）
 *  - 合計100,000点・順位1〜4が1人ずつ揃えば completed（＝通算順位に反映）
 *  - 満たさない場合も保存はするが reporting（＝集計対象外。順位を汚さない）
 *  - 表示名はサーバーが authorizedUsers から解決する（クライアントの申告値を信用しない）
 */
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/adminAuth", () => ({ checkAdminAuth: jest.fn().mockResolvedValue("admin@example.com") }));
jest.mock("@/lib/auditLog", () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));

import { getDb } from "@/lib/firebaseAdmin";
import { writeAuditLog } from "@/lib/auditLog";
import { POST } from "@/app/api/admin/mahjong/tables/route";
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
  });
  let autoId = 0;
  /** where().where().get() の連鎖に対応する簡易クエリ。 */
  const query = (c: string, conds: [string, unknown][]) => ({
    where: (f: string, _op: string, v: unknown) => query(c, [...conds, [f, v]]),
    get: async () => ({
      docs: [...col(c).entries()]
        .filter(([, v]) => conds.every(([f, val]) => v[f] === val))
        .map(([id, v]) => ({ id, data: () => v })),
    }),
  });
  const db = {
    batch: () => {
      const ops: [string, string, Data][] = [];
      return {
        set: (ref: { __c: string; id: string }, d: Data) => { ops.push([ref.__c, ref.id, d]); },
        commit: async () => { ops.forEach(([c, id, d]) => col(c).set(id, { ...d })); },
      };
    },
    collection: (c: string) => ({
      doc: (id?: string) => docRef(c, id ?? `auto-${++autoId}`),
      where: (f: string, _op: string, v: unknown) => query(c, [[f, v]]),
    }),
    getAll: async (...refs: { id: string }[]) =>
      refs.map((r) => ({ id: r.id, exists: col("users").has(r.id), data: () => col("users").get(r.id) })),
    __store: store,
    __set: (c: string, id: string, d: Data) => col(c).set(id, d),
  };
  return db;
}

let db: ReturnType<typeof makeDb>;

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

/** 卓に入れるメンバー4名を authorizedUsers/users に用意する。 */
function seedUsers() {
  const people = [
    { id: "U1", name: "会員A", role: "member" },
    { id: "U2", name: "会員B", role: "member" },
    { id: "U3", name: "ゲストC", role: "guest" },
    { id: "U4", name: "社員D", role: "staff" },
  ];
  people.forEach((p, i) => {
    db.__set("authorizedUsers", `auth-${i}`, { lineUserId: p.id, displayName: p.name, role: p.role, active: true });
    db.__set("users", p.id, { pictureUrl: `https://example.com/${p.id}.png` });
  });
}

const MEMBERS_OK = [
  { lineUserId: "U1", points: 45000, rank: 1 },
  { lineUserId: "U2", points: 28000, rank: 2 },
  { lineUserId: "U3", points: 18000, rank: 3 },
  { lineUserId: "U4", points: 9000, rank: 4 },
];

beforeEach(() => {
  db = makeDb();
  (getDb as jest.Mock).mockReturnValue(db);
  (writeAuditLog as jest.Mock).mockClear();
  db.__set("seasons", "s1", { gameCategory: "mahjong" });
  seedUsers();
});

const call = (body: unknown) => POST(req(body));
/** 1卓ぶんのボディ。members を渡すと1卓、tables を渡すと複数卓。 */
const okBody = (over: Partial<Record<string, unknown>> = {}) => {
  const { members, ...rest } = over as { members?: unknown };
  return {
    seasonId: "s1",
    eventDate: "2026-08-01",
    tables: [{ members: members ?? MEMBERS_OK }],
    ...rest,
  };
};

describe("正常系", () => {
  test("合計100,000点・順位1〜4が揃えば completed で作成される", async () => {
    const res = await call(okBody());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ success: true, completedCount: 1, reportingCount: 0 });
    expect(json.created[0]).toMatchObject({ round: 1, status: "completed" });

    const table = [...db.__store.get("mahjongTables")!.values()][0] as Data;
    expect(table.eventDate).toBe("2026-08-01");
    expect(table.status).toBe("completed");
    expect(table.createdBy).toBe("admin:admin@example.com");
    expect(table.memberIds).toEqual(["U1", "U2", "U3", "U4"]);
    // 管理者が意図して入れた値なので異常検知フラグは立てない
    expect(table.needsReview).toBe(false);
  });

  test("表示名・アイコンはサーバーが解決する（クライアント値を使わない）", async () => {
    await call(okBody({
      members: MEMBERS_OK.map((m) => ({ ...m, displayName: "詐称した名前" })),
    }));
    const table = [...db.__store.get("mahjongTables")!.values()][0] as Data;
    const members = table.members as { displayName: string; pictureUrl: string }[];
    expect(members.map((m) => m.displayName)).toEqual(["会員A", "会員B", "ゲストC", "社員D"]);
    expect(members[0].pictureUrl).toBe("https://example.com/U1.png");
  });

  test("ゲストも参加者に指定できる（この機能の目的）", async () => {
    const res = await call(okBody());
    expect((await res.json()).completedCount).toBe(1);
    const table = [...db.__store.get("mahjongTables")!.values()][0] as Data;
    expect((table.memberIds as string[])).toContain("U3");
  });

  test("監査ログを残す", async () => {
    await call(okBody());
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "table.adminCreated", gameCategory: "mahjong", actor: "admin@example.com" })
    );
  });
});

describe("検証に通らない場合は保存するが集計対象外(reporting)", () => {
  test("合計が100,000点でないと reporting", async () => {
    const res = await call(okBody({
      members: [
        { lineUserId: "U1", points: 45000, rank: 1 },
        { lineUserId: "U2", points: 28000, rank: 2 },
        { lineUserId: "U3", points: 18000, rank: 3 },
        { lineUserId: "U4", points: 8000, rank: 4 }, // 合計 99,000
      ],
    }));
    const json = await res.json();
    expect(json).toMatchObject({ completedCount: 0, reportingCount: 1 });
    expect(json.created[0].error).toMatch(/100,000/);
    const table = [...db.__store.get("mahjongTables")!.values()][0] as Data;
    expect(table.status).toBe("reporting");
  });

  test("順位が重複していると reporting", async () => {
    const res = await call(okBody({
      members: [
        { lineUserId: "U1", points: 45000, rank: 1 },
        { lineUserId: "U2", points: 28000, rank: 1 },
        { lineUserId: "U3", points: 18000, rank: 3 },
        { lineUserId: "U4", points: 9000, rank: 4 },
      ],
    }));
    expect((await res.json()).reportingCount).toBe(1);
  });
});

describe("複数卓（1日ぶんをまとめて登録）", () => {
  /** 参加者6名から3卓ぶんを作る（同じ人が複数卓に出るのが通常＝アベレージの母数になる）。 */
  test("卓ごとに第n半荘の番号が振られ、全卓が保存される", async () => {
    db.__set("authorizedUsers", "auth-4", { lineUserId: "U5", displayName: "会員E", role: "member", active: true });
    db.__set("authorizedUsers", "auth-5", { lineUserId: "U6", displayName: "会員F", role: "member", active: true });
    const t = (ids: string[]) => ({
      members: [
        { lineUserId: ids[0], points: 45000, rank: 1 },
        { lineUserId: ids[1], points: 28000, rank: 2 },
        { lineUserId: ids[2], points: 18000, rank: 3 },
        { lineUserId: ids[3], points: 9000, rank: 4 },
      ],
    });
    const res = await call({
      seasonId: "s1", eventDate: "2026-08-01",
      tables: [t(["U1","U2","U3","U4"]), t(["U1","U2","U5","U6"]), t(["U3","U4","U5","U6"])],
    });
    const json = await res.json();

    expect(json).toMatchObject({ success: true, completedCount: 3, reportingCount: 0 });
    expect(json.created.map((c: { round: number }) => c.round)).toEqual([1, 2, 3]);
    expect(db.__store.get("mahjongTables")!.size).toBe(3);
  });

  test("既にその日に卓があれば続きの半荘番号になる", async () => {
    db.__set("mahjongTables", "existing", { seasonId: "s1", eventDate: "2026-08-01", round: 4 });
    const json = await (await call(okBody())).json();
    expect(json.created[0].round).toBe(5);
  });

  test("合計が合わない卓だけ reporting になり、他の卓は completed のまま", async () => {
    const bad = { members: [
      { lineUserId: "U1", points: 45000, rank: 1 },
      { lineUserId: "U2", points: 28000, rank: 2 },
      { lineUserId: "U3", points: 18000, rank: 3 },
      { lineUserId: "U4", points: 8000, rank: 4 },
    ]};
    const json = await (await call({
      seasonId: "s1", eventDate: "2026-08-01", tables: [{ members: MEMBERS_OK }, bad],
    })).json();
    expect(json).toMatchObject({ completedCount: 1, reportingCount: 1 });
  });

  test("卓が0件なら 400", async () => {
    expect((await call({ seasonId: "s1", eventDate: "2026-08-01", tables: [] })).status).toBe(400);
  });

  test("上限(30卓)を超えたら 400", async () => {
    const many = Array.from({ length: 31 }, () => ({ members: MEMBERS_OK }));
    const res = await call({ seasonId: "s1", eventDate: "2026-08-01", tables: many });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/30卓/);
  });

  test("不正な卓は何卓目かを示して 400（どこを直せばよいか分かる）", async () => {
    const res = await call({
      seasonId: "s1", eventDate: "2026-08-01",
      tables: [{ members: MEMBERS_OK }, { members: MEMBERS_OK.slice(0, 3) }],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/^2卓目/);
    // 1件も保存されない（半端に残さない）
    expect(db.__store.get("mahjongTables")?.size ?? 0).toBe(0);
  });
});

describe("入力チェック", () => {
  test("4名でなければ 400", async () => {
    const res = await call(okBody({ members: MEMBERS_OK.slice(0, 3) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/4名/);
  });

  test("同じ人を複数の席に入れたら 400", async () => {
    const res = await call(okBody({
      members: [
        { lineUserId: "U1", points: 45000, rank: 1 },
        { lineUserId: "U1", points: 28000, rank: 2 },
        { lineUserId: "U3", points: 18000, rank: 3 },
        { lineUserId: "U4", points: 9000, rank: 4 },
      ],
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/同じ人を複数の席/);
  });

  test("eventDate の形式が不正なら 400", async () => {
    expect((await call(okBody({ eventDate: "2026/08/01" }))).status).toBe(400);
  });

  test("rank が範囲外なら 400", async () => {
    const res = await call(okBody({
      members: [{ ...MEMBERS_OK[0], rank: 5 }, ...MEMBERS_OK.slice(1)],
    }));
    expect(res.status).toBe(400);
  });

  test("points が整数でなければ 400", async () => {
    const res = await call(okBody({
      members: [{ ...MEMBERS_OK[0], points: 45000.5 }, ...MEMBERS_OK.slice(1)],
    }));
    expect(res.status).toBe(400);
  });

  test("存在しないシーズンは 404", async () => {
    expect((await call(okBody({ seasonId: "nope" }))).status).toBe(404);
  });

  test("麻雀以外のシーズンは 400", async () => {
    db.__set("seasons", "darts1", { gameCategory: "darts" });
    expect((await call(okBody({ seasonId: "darts1" }))).status).toBe(400);
  });

  test("利用者として登録されていない人は 400（卓は作られない）", async () => {
    const res = await call(okBody({
      members: [{ lineUserId: "UNKNOWN", points: 45000, rank: 1 }, ...MEMBERS_OK.slice(1)],
    }));
    expect(res.status).toBe(400);
    expect(db.__store.get("mahjongTables")?.size ?? 0).toBe(0);
  });
});
