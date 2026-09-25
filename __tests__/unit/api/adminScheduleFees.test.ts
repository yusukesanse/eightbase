jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/adminAuth", () => ({ checkAdminAuth: async () => "admin" }));
jest.mock("@/lib/auditLog", () => ({ writeAuditLog: jest.fn() }));
import { scheduleLockId } from "@/lib/gameSchedule";
import { getDb } from "@/lib/firebaseAdmin";
import { GET, POST, PATCH } from "@/app/api/admin/games/schedule/route";
import { POST as CLOSE } from "@/app/api/admin/mahjong/closed-dates/route";
import { makeDb } from "../../helpers/scheduleDb";
import type { NextRequest } from "next/server";
const DATE = "2026-10-02"; // 金曜
const base = { gameCategory: "mahjong", seasonId: "S1", date: DATE };
const postTimes = { startTime: "18:00", endTime: "21:00" };
const req = (body: unknown) => ({ json: async () => body, nextUrl: new URL("https://example.com?gameCategory=mahjong&seasonId=S1") }) as NextRequest;
let db: ReturnType<typeof makeDb>;
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date("2026-09-25T00:00:00Z"));
  db = makeDb(); (getDb as jest.Mock).mockReturnValue(db);
  db.__set("seasons", "S1", { startDate: DATE, endDate: "2026-10-16" });
});
afterEach(() => jest.useRealTimers());
const bulk = { bulk: true, weekday: 5, intervalWeeks: 1 };
test.each([undefined, 0, -1, 1.5, "5000", 100001])("POST料金 %s は単日・一括とも400、書込なし", async (entryFee) => {
  for (const extra of [{}, bulk]) {
    expect((await POST(req({ ...base, ...postTimes, ...extra, entryFee }))).status).toBe(400);
    expect(db.__size("mahjongSchedule")).toBe(0);
  }
});
test.each([1, 5000, 100000])("有効料金 %s は単日・一括で保存", async (entryFee) => {
  expect((await POST(req({ ...base, ...postTimes, entryFee }))).status).toBe(201);
  expect(db.__get("mahjongSchedule", `S1_${DATE}`)?.entryFee).toBe(entryFee);
  expect((await POST(req({ ...base, ...postTimes, ...bulk, entryFee }))).status).toBe(200);
  expect(db.__get("mahjongSchedule", "S1_2026-10-09")?.entryFee).toBe(entryFee);
});
test("一括・単日再追加で既存料金を変更しない（旧自動ID含む）", async () => {
  db.__set("mahjongSchedule", "legacy", { seasonId: "S1", date: DATE, entryFee: 5000 });
  db.__set("mahjongSchedule", "S1_2026-10-09", { seasonId: "S1", date: "2026-10-09", entryFee: 6000, timeOverridden: true, startTime: "12:00", endTime: "13:00" });
  await POST(req({ ...base, ...postTimes, ...bulk, entryFee: 7000 }));
  expect((await (await GET(req(null))).json()).entryFees).toEqual({ [DATE]: 5000, "2026-10-09": 6000, "2026-10-16": 7000 });
  expect(db.__get("mahjongSchedule", "S1_2026-10-09")?.startTime).toBe("18:00");
  expect(db.__get("mahjongSchedule", "S1_2026-10-09")?.endTime).toBe("21:00");
  await POST(req({ ...base, ...postTimes, entryFee: 8000 }));
  expect((await (await GET(req(null))).json()).entryFees[DATE]).toBe(5000);
});
test("料金のみPATCHでき、時刻の個別変更フラグ・entriesは不変", async () => {
  db.__set("mahjongSchedule", `S1_${DATE}`, { seasonId: "S1", date: DATE, startTime: "10:00", endTime: "11:00", timeOverridden: false });
  db.__set("mahjongEntries", "old", { paymentAmount: 5000 });
  expect((await (await GET(req(null))).json()).entryFees[DATE]).toBe(3000);
  expect((await PATCH(req({ ...base, entryFee: 7000 }))).status).toBe(200);
  expect(db.__get("mahjongSchedule", `S1_${DATE}`)).toMatchObject({ entryFee: 7000, timeOverridden: false });
  expect(db.__get("mahjongEntries", "old")?.paymentAmount).toBe(5000);
});
test.each([0, -1, 1.5, "5000", 100001, null])("PATCH不正料金 %s は書込なし", async (entryFee) => {
  db.__set("mahjongSchedule", `S1_${DATE}`, { seasonId: "S1", date: DATE, entryFee: 5000 });
  expect((await PATCH(req({ ...base, entryFee }))).status).toBe(400);
  expect(db.__get("mahjongSchedule", `S1_${DATE}`)?.entryFee).toBe(5000);
});
test.each(["darts", "billiards", "poker"])("%s は料金を保存・返却しない", async (gameCategory) => {
  for (const extra of [{}, bulk]) await POST(req({ ...base, ...postTimes, ...extra, gameCategory, entryFee: 7000 }));
  await PATCH(req({ ...base, gameCategory, entryFee: 8000, startTime: "12:00", endTime: "13:00" }));
  expect(db.__get(`${gameCategory}Schedule`, `S1_${DATE}`)?.entryFee).toBeUndefined();
  const r = req(null); r.nextUrl.searchParams.set("gameCategory", gameCategory);
  expect((await (await GET(r)).json()).entryFees).toBeUndefined();
});
test("休催POSTは金曜も受付", async () => {
  expect((await CLOSE(req({ date: DATE }))).status).toBe(200);
  expect(db.__get("mahjongClosedDates", DATE)?.date).toBe(DATE);
});
test.each(["2026-02-30", "bad"])("休催は実在しない日 %s を拒否", async (date) => {
  expect((await CLOSE(req({ date }))).status).toBe(400);
  expect(db.__size("mahjongClosedDates")).toBe(0);
});
test("料金PATCHは旧自動IDの日程も更新し、同日の重複docの料金も揃う", async () => {
  db.__set("mahjongSchedule", "legacy", { seasonId: "S1", date: DATE, entryFee: 5000 });
  expect((await PATCH(req({ ...base, entryFee: 6000 }))).status).toBe(200);
  expect(db.__get("mahjongSchedule", "legacy")?.entryFee).toBe(6000);
  db.__set("mahjongSchedule", `S1_${DATE}`, { seasonId: "S1", date: DATE, entryFee: 6000 });
  await PATCH(req({ ...base, entryFee: 7000 }));
  expect(db.__get("mahjongSchedule", "legacy")?.entryFee).toBe(7000);
  expect(db.__get("mahjongSchedule", `S1_${DATE}`)?.entryFee).toBe(7000);
});

test.each([`S1_${DATE}`, "legacy-unset"])("B: 一括追加は既存未設定日 %s に料金を書かない", async (id) => {
  db.__set("mahjongSchedule", id, { seasonId: "S1", date: DATE });
  db.__set("mahjongSchedule", "S1_2026-10-09", { seasonId: "S1", date: "2026-10-09", entryFee: 5000 });
  expect((await POST(req({ ...base, ...postTimes, ...bulk, entryFee: 7000 }))).status).toBe(200);
  expect(db.__get("mahjongSchedule", id)).not.toHaveProperty("entryFee");
  expect(db.__get("mahjongSchedule", `S1_${DATE}`)).not.toHaveProperty("entryFee");
  expect((await (await GET(req(null))).json()).entryFees).toEqual({ [DATE]: 3000, "2026-10-09": 5000, "2026-10-16": 7000 });
});
test.each([`S1_${DATE}`, "legacy-existing"])("C: 単日再追加は既存doc %s を変更せず実効料金を返す", async (id) => {
  const existing = { seasonId: "S1", date: DATE, entryFee: 5000, startTime: "12:00", endTime: "13:00", createdAt: "2020-01-01", timeOverridden: true };
  db.__set("mahjongSchedule", id, existing);
  const res = await POST(req({ ...base, ...postTimes, entryFee: 9000 }));
  expect(res.status).toBe(201);
  expect(db.__get("mahjongSchedule", id)).toEqual(existing);
  expect(db.__size("mahjongSchedule")).toBe(1);
  expect(await res.json()).toMatchObject({ entryFee: 5000 });
});
test.each([undefined, 0])("C: 既存の未設定・不正料金 %s は3000を返し保存値は不変", async (entryFee) => {
  const existing = { seasonId: "S1", date: DATE, ...(entryFee === undefined ? {} : { entryFee }) };
  db.__set("mahjongSchedule", "legacy", existing);
  expect(await (await POST(req({ ...base, ...postTimes, entryFee: 9000 }))).json()).toMatchObject({ entryFee: 3000 });
  expect(db.__get("mahjongSchedule", "legacy")).toEqual(existing);
  expect(db.__size("mahjongSchedule")).toBe(1);
});
test("C: 新規日は指定料金を保存して返す", async () => {
  expect(await (await POST(req({ ...base, ...postTimes, entryFee: 9000 }))).json()).toMatchObject({ entryFee: 9000 });
  expect(db.__get("mahjongSchedule", `S1_${DATE}`)?.entryFee).toBe(9000);
});

describe.each(["mahjong", "darts", "billiards", "poker"] as const)("%s の登録時刻", (gameCategory) => {
  describe.each([false, true])("bulk=%s", (isBulk) => {
    const invalidTimes = [
      {}, { startTime: "18:00" }, { endTime: "21:00" },
      ...["9:00", "25:00", "18:60", 1800, null, ""].flatMap((value) => [
        { startTime: value, endTime: "21:00" }, { startTime: "18:00", endTime: value },
      ]),
      { startTime: "21:00", endTime: "21:00" }, { startTime: "22:00", endTime: "21:00" },
    ];
    test.each(invalidTimes)("不正時刻 %j は400で書き込まない", async (times) => {
      const batch = jest.spyOn(db, "batch");
      const transaction = jest.spyOn(db, "runTransaction");
      const response = await POST(req({ gameCategory, seasonId: "S1", date: DATE, entryFee: 5000, ...(isBulk ? bulk : {}), ...times }));
      expect(response.status).toBe(400);
      expect(db.__size(`${gameCategory}Schedule`)).toBe(0);
      expect(batch).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    });
    test("シーズン既定値より入力時刻を優先して新規保存する", async () => {
      db.__set("seasons", "S1", { startDate: DATE, endDate: "2026-10-16", defaultStartTime: "09:00", defaultEndTime: "10:00" });
      const response = await POST(req({ ...base, ...postTimes, gameCategory, entryFee: 5000, ...(isBulk ? bulk : {}) }));
      expect(response.status).toBe(isBulk ? 200 : 201);
      for (const date of isBulk ? [DATE, "2026-10-09", "2026-10-16"] : [DATE]) {
        const saved = db.__get(`${gameCategory}Schedule`, `S1_${date}`);
        expect(saved).toMatchObject({ startTime: "18:00", endTime: "21:00" });
        expect(saved).not.toHaveProperty("timeOverridden");
      }
    });
  });
  describe.each([false, true])("一括登録: timeOverridden=%s", (overridden) => {
    test.each([
      ["過去", DATE, false],
      ["今日", "2026-10-09", false],
      ["未来", "2026-10-16", true],
    ] as const)("%sの既存日は未来だけ時刻を上書きし料金と変更フラグを維持", async (_label, date, overwrite) => {
      // UTCでは10/8、JSTでは10/9。サーバーのローカル日付で判定すると今日の検証が失敗する。
      jest.setSystemTime(new Date("2026-10-08T15:00:00Z"));
      db.__set(`${gameCategory}Schedule`, `S1_${date}`, { seasonId: "S1", date, startTime: "12:00", endTime: "13:00", timeOverridden: overridden, ...(gameCategory === "mahjong" ? { entryFee: 6000 } : {}) });
      db.__set("scheduleLocks", scheduleLockId(gameCategory, "S1", date), { blocked: true });
      expect((await POST(req({ ...base, ...postTimes, ...bulk, gameCategory, entryFee: 7000 }))).status).toBe(200);
      const saved = db.__get(`${gameCategory}Schedule`, `S1_${date}`);
      expect(saved).toMatchObject({ startTime: overwrite ? "18:00" : "12:00", endTime: overwrite ? "21:00" : "13:00", timeOverridden: overridden });
      if (gameCategory === "mahjong") expect(saved?.entryFee).toBe(6000);
      expect(db.__get("scheduleLocks", scheduleLockId(gameCategory, "S1", date))).toBeUndefined();
    });
  });
  test.each(["2026-10-01T15:00:00Z", "2026-10-08T15:00:00Z", "2026-10-15T15:00:00Z"])("新規日は今日が%sでも入力時刻と料金で作成する", async (now) => {
    jest.setSystemTime(new Date(now));
    expect((await POST(req({ ...base, ...postTimes, ...bulk, gameCategory, entryFee: 7000 }))).status).toBe(200);
    for (const date of [DATE, "2026-10-09", "2026-10-16"]) {
      const saved = db.__get(`${gameCategory}Schedule`, `S1_${date}`);
      expect(saved).toMatchObject(postTimes);
      if (gameCategory === "mahjong") expect(saved?.entryFee).toBe(7000);
    }
  });
});
