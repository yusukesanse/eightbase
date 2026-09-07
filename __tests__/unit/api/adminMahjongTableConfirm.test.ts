/**
 * 単体テスト: PATCH /api/admin/mahjong/tables/[tableId]（action="confirm"）
 *
 * 固定する仕様（2026-09-07: 管理者は合計 100,000 点でなくても確定できる）:
 *  - 通常の confirm: 合計が 100,000 点なら completed、違えば reporting のまま理由を返す（従来どおり）
 *  - force=true: 合計が合わなくても completed にし、順位は持ち点から振り直す。
 *    reviewReason に「合計不一致のまま確定」と合計点を残し、監査ログ table.adminForceConfirmed を書く
 *  - force=true でも未入力の席がある卓は確定しない（何を集計するか決まらない）
 *  - 管理者でなければ 401
 */
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/adminAuth", () => ({ checkAdminAuth: jest.fn().mockResolvedValue("admin@example.com") }));
jest.mock("@/lib/auditLog", () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));

import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { writeAuditLog } from "@/lib/auditLog";
import { PATCH } from "@/app/api/admin/mahjong/tables/[tableId]/route";
import type { NextRequest } from "next/server";

type Data = Record<string, unknown>;

function makeDb() {
  const store = new Map<string, Data>();
  const db = {
    collection: () => ({
      where: () => ({ get: async () => ({ docs: [
        { data: () => ({ lineUserId: "U5", displayName: "後から参加したゲスト", active: true }) },
      ] }) }),
      doc: (id: string) => ({
        get: async () => ({ exists: store.has(id), id, data: () => store.get(id) }),
        update: async (patch: Data) => { store.set(id, { ...(store.get(id) ?? {}), ...patch }); },
      }),
    }),
    __store: store,
  };
  return db;
}

let db: ReturnType<typeof makeDb>;
const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const params = (tableId: string) => ({ params: Promise.resolve({ tableId }) });

const member = (id: string, points: number | null, rank: number | null = null) => ({
  lineUserId: id, displayName: id, pictureUrl: "", points, rank, reportedAt: points === null ? null : "2026-08-01T10:00:00.000Z",
});

beforeEach(() => {
  db = makeDb();
  (getDb as jest.Mock).mockReturnValue(db);
  (checkAdminAuth as jest.Mock).mockResolvedValue("admin@example.com");
  (writeAuditLog as jest.Mock).mockClear();
});

function seed(points: (number | null)[]) {
  db.__store.set("t1", {
    tableId: "t1", seasonId: "s1", eventDate: "2026-08-01", status: "reporting",
    memberIds: ["U1", "U2", "U3", "U4"],
    members: points.map((p, i) => member(`U${i + 1}`, p, i + 1)),
  });
}

describe("通常の確定（従来どおり）", () => {
  test("個人が10万点を超えていても合計が10万点なら確定できる", async () => {
    seed([120000, 10000, -10000, -20000]);
    const json = await (await PATCH(req({ action: "confirm" }), params("t1"))).json();
    expect(json).toMatchObject({ success: true, tableStatus: "completed", forced: false });
  });
  test("合計 100,000 点なら completed", async () => {
    seed([45000, 28000, 18000, 9000]);
    const json = await (await PATCH(req({ action: "confirm" }), params("t1"))).json();
    expect(json).toMatchObject({ success: true, tableStatus: "completed", forced: false });
    expect(db.__store.get("t1")!.status).toBe("completed");
  });

  test("合計が合わなければ reporting のまま理由を返す", async () => {
    seed([45000, 28000, 18000, 8000]); // 99,000
    const json = await (await PATCH(req({ action: "confirm" }), params("t1"))).json();
    expect(json.tableStatus).toBe("reporting");
    expect(json.validation.allReported).toBe(true);
    expect(json.validation.total).toBe(99000);
    expect(db.__store.get("t1")!.status).toBe("reporting");
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("force=true（管理者権限で合計不一致のまま確定）", () => {
  test("合計が10万点を超えても管理者確定できる", async () => {
    seed([120000, 30000, 20000, 10000]);
    const json = await (await PATCH(req({ action: "confirm", force: true }), params("t1"))).json();
    expect(json).toMatchObject({ success: true, tableStatus: "completed", forced: true });
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({ total: 180000 }),
    }));
  });
  test("合計が合わなくても completed になり、順位は持ち点から振り直す", async () => {
    // 行順と点数が逆転している（4位に最高点）＝持ち点から順位を振り直せることも同時に確認
    seed([8000, 18000, 28000, 45000]); // 99,000
    const json = await (await PATCH(req({ action: "confirm", force: true }), params("t1"))).json();
    expect(json).toMatchObject({ success: true, tableStatus: "completed", forced: true });
    const saved = db.__store.get("t1")!;
    expect(saved.status).toBe("completed");
    expect((saved.members as { lineUserId: string; rank: number }[]).map((m) => [m.lineUserId, m.rank]))
      .toEqual([["U1", 4], ["U2", 3], ["U3", 2], ["U4", 1]]);
    expect(saved.reviewReason).toMatch(/合計不一致（99,000点）/);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "table.adminForceConfirmed", actor: "admin@example.com", meta: expect.objectContaining({ total: 99000 }) })
    );
  });

  test("force でも未入力の席があれば確定しない", async () => {
    seed([45000, 28000, null, 9000]);
    const json = await (await PATCH(req({ action: "confirm", force: true }), params("t1"))).json();
    expect(json.tableStatus).toBe("reporting");
    expect(json.forced).toBe(false);
    expect(db.__store.get("t1")!.status).toBe("reporting");
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  test("合計が合っているときは force を付けても通常の確定（監査ログは書かない）", async () => {
    seed([45000, 28000, 18000, 9000]);
    const json = await (await PATCH(req({ action: "confirm", force: true }), params("t1"))).json();
    expect(json).toMatchObject({ tableStatus: "completed", forced: false });
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  test("force の値が true 以外（\"true\" や 1）なら通常の確定として扱う", async () => {
    seed([45000, 28000, 18000, 8000]);
    for (const force of ["true", 1, {}]) {
      const json = await (await PATCH(req({ action: "confirm", force }), params("t1"))).json();
      expect(json.tableStatus).toBe("reporting");
    }
  });

  test("卓が無ければ 404", async () => {
    const res = await PATCH(req({ action: "confirm", force: true }), params("nope"));
    expect(res.status).toBe(404);
  });

  test("管理者でなければ 401", async () => {
    (checkAdminAuth as jest.Mock).mockResolvedValueOnce(null);
    seed([45000, 28000, 18000, 8000]);
    const res = await PATCH(req({ action: "confirm", force: true }), params("t1"));
    expect(res.status).toBe(401);
    expect(db.__store.get("t1")!.status).toBe("reporting");
  });
});

describe("卓ラベルの編集", () => {
  test.each(["reporting", "completed"])("メンバーの入れ替えで席の結果と %s 状態を維持する", async (status) => {
    seed([120000, 30000, 20000, 10000]);
    db.__store.get("t1")!.status = status;
    db.__store.set("U5", { pictureUrl: "https://example.com/guest.png" });
    const memberIds = ["U5", "U2", "U3", "U4"];
    const res = await PATCH(req({ memberIds, tableLabel: "B", round: 3 }), params("t1"));
    expect(res.status).toBe(200);
    expect(db.__store.get("t1")).toMatchObject({
      memberIds, status, tableLabel: "B", round: 3,
      members: [
        expect.objectContaining({ lineUserId: "U5", displayName: "後から参加したゲスト", pictureUrl: "https://example.com/guest.png", points: 120000, rank: 1 }),
        expect.objectContaining({ lineUserId: "U2" }),
        expect.objectContaining({ lineUserId: "U3" }),
        expect.objectContaining({ lineUserId: "U4" }),
      ],
    });
  });

  test("未申告のままメンバーを変更できる", async () => {
    seed([null, null, null, null]);
    const res = await PATCH(req({ memberIds: ["U5", "U2", "U3", "U4"] }), params("t1"));
    expect(res.status).toBe(200);
    expect((db.__store.get("t1")!.members as Data[])[0]).toMatchObject({ lineUserId: "U5", points: null });
    expect(db.__store.get("t1")!.status).toBe("reporting");
  });

  test("メンバーと点数を同時に変更できる", async () => {
    seed([null, null, null, null]);
    const memberIds = ["U5", "U2", "U3", "U4"];
    const members = [45000, 28000, 18000, 9000].map((points, i) => ({ lineUserId: memberIds[i], points, rank: i + 1 }));
    const res = await PATCH(req({ memberIds, members }), params("t1"));
    expect(res.status).toBe(200);
    expect(db.__store.get("t1")).toMatchObject({ memberIds, members, status: "completed" });
  });

  test.each([
    [["U5", "U5", "U3", "U4"]],
    [["U5", "U2", "U3"]],
    [["unknown", "U2", "U3", "U4"]],
  ])("重複・人数不足・未登録のメンバーは拒否する: %p", async (memberIds) => {
    seed([45000, 28000, 18000, 9000]);
    const before = structuredClone(db.__store.get("t1"));
    const res = await PATCH(req({ memberIds }), params("t1"));
    expect(res.status).toBe(400);
    expect(db.__store.get("t1")).toEqual(before);
  });

  test.each([1, 99])("半荘番号を %i に変更しても点数と確定状態を維持する", async (round) => {
    seed([120000, 30000, 20000, 10000]);
    Object.assign(db.__store.get("t1")!, { round: 2, tableLabel: "A", status: "completed" });
    const members = db.__store.get("t1")!.members;
    const res = await PATCH(req({ round }), params("t1"));
    expect(res.status).toBe(200);
    expect(db.__store.get("t1")).toMatchObject({ round, tableLabel: "A", status: "completed", members });
  });

  test("半荘番号・卓・点数を同時に変更できる", async () => {
    seed([null, null, null, null]);
    const members = [45000, 28000, 18000, 9000].map((points, i) => ({ lineUserId: `U${i + 1}`, points, rank: i + 1 }));
    const res = await PATCH(req({ round: 3, tableLabel: "B", members }), params("t1"));
    expect(res.status).toBe(200);
    expect(db.__store.get("t1")).toMatchObject({ round: 3, tableLabel: "B", members, status: "completed" });
  });

  test.each([0, -1, 1.5, 100, "2", null])("不正な半荘番号 %p は保存しない", async (round) => {
    seed([null, null, null, null]);
    const res = await PATCH(req({ round }), params("t1"));
    expect(res.status).toBe(400);
    expect(db.__store.get("t1")!.round).toBeUndefined();
  });

  test("未申告の卓でもA卓からB卓へ変更でき、点数と状態を維持する", async () => {
    seed([null, null, null, null]);
    db.__store.get("t1")!.tableLabel = "A";
    const before = db.__store.get("t1")!.members;
    const res = await PATCH(req({ tableLabel: "B" }), params("t1"));
    expect(res.status).toBe(200);
    expect(db.__store.get("t1")).toMatchObject({ tableLabel: "B", status: "reporting", members: before });
  });

  test("管理者確定済みの卓はラベルだけ変えても確定状態を維持する", async () => {
    seed([120000, 30000, 20000, 10000]);
    db.__store.get("t1")!.status = "completed";
    await PATCH(req({ tableLabel: "A" }), params("t1"));
    expect(db.__store.get("t1")).toMatchObject({ tableLabel: "A", status: "completed" });
  });

  test("点数と卓ラベルを一緒に保存できる", async () => {
    seed([45000, 28000, 18000, 9000]);
    const members = [120000, 10000, -10000, -20000].map((points, i) => ({ lineUserId: `U${i + 1}`, points, rank: i + 1 }));
    const res = await PATCH(req({ tableLabel: "B", members }), params("t1"));
    expect(res.status).toBe(200);
    expect(db.__store.get("t1")).toMatchObject({ tableLabel: "B", status: "completed", members });
  });

  test("空文字で卓ラベルを解除できる", async () => {
    seed([45000, 28000, 18000, 9000]);
    await PATCH(req({ tableLabel: "" }), params("t1"));
    expect(db.__store.get("t1")!.tableLabel).toBe("");
  });

  test.each(["X", "AB", 1, null])("不正な卓ラベル %p は保存しない", async (tableLabel) => {
    seed([45000, 28000, 18000, 9000]);
    const res = await PATCH(req({ tableLabel }), params("t1"));
    expect(res.status).toBe(400);
    expect(db.__store.get("t1")!.tableLabel).toBeUndefined();
  });
});
