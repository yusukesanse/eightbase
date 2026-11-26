/**
 * GET /api/poker/day と POST /api/poker/day/confirm の境界。
 * 30分経過の自動切替（GET は書き込まない）、ディーラーもプレイヤー、results、finishDay の受け取り。
 */
jest.mock("@/lib/auth", () => ({ requireGameUser: jest.fn() }));
jest.mock("@/lib/mahjong", () => ({ getActiveSeason: jest.fn() }));
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/line", () => ({ sendGameForfeitNotice: jest.fn() }));
jest.mock("@/lib/pokerSchedule", () => ({ isScheduledPokerDate: jest.fn().mockResolvedValue(true) }));
jest.mock("@/lib/pokerDay", () => ({
  ...jest.requireActual("@/lib/pokerDay"),
  getPokerDayState: jest.fn(),
  fetchPokerParticipants: jest.fn(),
  confirmPokerGame: jest.fn(),
}));

import { GET } from "@/app/api/poker/day/route";
import { POST as CONFIRM } from "@/app/api/poker/day/confirm/route";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { getPokerDayState, confirmPokerGame } from "@/lib/pokerDay";
import type { PokerDayState, PokerGameState } from "@/types/poker";
import type { NextRequest } from "next/server";

const DATE = "2026-07-04";
const getReq = () => ({ nextUrl: { searchParams: new URLSearchParams({ eventDate: DATE }) } } as unknown as NextRequest);
const postReq = (body: unknown) => ({ json: async () => body } as unknown as NextRequest);
const asUser = (id: string) => (requireGameUser as jest.Mock).mockResolvedValue(id);
const members = ["a", "b", "c"].map((id) => ({ lineUserId: id, displayName: id.toUpperCase(), paid: true }));
const dayWith = (games: PokerGameState[], over: Partial<PokerDayState> = {}): PokerDayState => ({
  seasonId: "s1", eventDate: DATE, participants: members, entryClosedAt: "2026-07-04T04:00:00.000Z",
  games, finishedAt: null, finishedBy: null, updatedAt: "", ...over,
});
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const confirmedGame: PokerGameState = {
  gameIndex: 1, dealerId: "a", status: "confirmed",
  reports: { a: { chips: 10000, reportedAt: "" }, b: { chips: 15000, reportedAt: "" }, c: { chips: 5000, reportedAt: "" } },
};

beforeEach(() => {
  jest.clearAllMocks();
  (getActiveSeason as jest.Mock).mockResolvedValue({ seasonId: "s1" });
});

describe("GET /api/poker/day", () => {
  test("ディーラーもプレイヤーに数える（total・maxChips・iAmPlayer）", async () => {
    asUser("a");
    (getPokerDayState as jest.Mock).mockResolvedValue(dayWith([{ gameIndex: 1, dealerId: "a", status: "reporting", reports: {} }]));
    const body = await (await GET(getReq())).json();
    expect(body.currentGame).toMatchObject({ iAmDealer: true, iAmPlayer: true, total: 3, maxChips: 30000 });
    expect(body.currentGame.players.map((p: { displayName: string }) => p.displayName)).toEqual(["A", "B", "C"]);
  });

  test("30分を過ぎた playing は reporting として返す", async () => {
    asUser("b");
    (getPokerDayState as jest.Mock).mockResolvedValue(dayWith([{ gameIndex: 1, dealerId: "a", status: "playing", startedAt: minsAgo(31), reports: {} }]));
    const body = await (await GET(getReq())).json();
    expect(body.phase).toBe("reporting");
    expect(body.currentGame.status).toBe("reporting");
  });

  test("30分たつ前の playing は playing のまま", async () => {
    asUser("b");
    (getPokerDayState as jest.Mock).mockResolvedValue(dayWith([{ gameIndex: 1, dealerId: "a", status: "playing", startedAt: minsAgo(29), reports: {} }]));
    const body = await (await GET(getReq())).json();
    expect(body.phase).toBe("playing");
  });

  test("確定済みの試合があれば results を返し、lineUserId はディーラー以外へ出さない", async () => {
    asUser("b");
    (getPokerDayState as jest.Mock).mockResolvedValue(dayWith([confirmedGame]));
    const res = await GET(getReq());
    const body = await res.json();
    expect(body.phase).toBe("dealerSelect");
    expect(body.results.map((r: { displayName: string; totalChips: number }) => [r.displayName, r.totalChips])).toEqual([["B", 15000], ["A", 10000], ["C", 5000]]);
    expect(JSON.stringify(body)).not.toContain("lineUserId");
    expect(body.iCanFinishDay).toBe(false);
  });

  test("直前に確定した試合のディーラーにだけ iCanFinishDay を立てる", async () => {
    asUser("a");
    (getPokerDayState as jest.Mock).mockResolvedValue(dayWith([confirmedGame]));
    expect((await (await GET(getReq())).json()).iCanFinishDay).toBe(true);
  });

  describe("次の試合が ready のときの iCanFinishDay", () => {
    const readyAfterConfirmed = () => dayWith([confirmedGame, { gameIndex: 2, dealerId: "b", status: "ready", reports: {} }]);
    test.each([["b", true], ["a", true], ["c", false]])("%s → %s（ready のディーラーと直前のディーラーだけ）", async (uid, expected) => {
      asUser(uid);
      (getPokerDayState as jest.Mock).mockResolvedValue(readyAfterConfirmed());
      const body = await (await GET(getReq())).json();
      expect(body.phase).toBe("ready");
      expect(body.iCanFinishDay).toBe(expected);
    });

    test("確定済みの試合が無い日（最初の試合が ready）は誰も終了できない", async () => {
      asUser("a");
      (getPokerDayState as jest.Mock).mockResolvedValue(dayWith([{ gameIndex: 1, dealerId: "a", status: "ready", reports: {} }]));
      expect((await (await GET(getReq())).json()).iCanFinishDay).toBe(false);
    });
  });

  test("本日終了後は finished と results", async () => {
    asUser("c");
    (getPokerDayState as jest.Mock).mockResolvedValue(dayWith([confirmedGame], { finishedAt: "2026-07-04T06:00:00.000Z", finishedBy: "a" }));
    const body = await (await GET(getReq())).json();
    expect(body.phase).toBe("finished");
    expect(body.results).toHaveLength(3);
    expect(body.iCanFinishDay).toBe(false);
  });
});

describe("POST /api/poker/day/confirm", () => {
  beforeEach(() => { asUser("a"); (confirmPokerGame as jest.Mock).mockResolvedValue({ ok: true }); });

  test("finishDay を confirmPokerGame へ渡す", async () => {
    const res = await CONFIRM(postReq({ eventDate: DATE, finishDay: true }));
    expect(res.status).toBe(200);
    expect(confirmPokerGame).toHaveBeenCalledWith("s1", DATE, "a", { finishDay: true });
  });

  test("finishDay を省くと false", async () => {
    await CONFIRM(postReq({ eventDate: DATE }));
    expect(confirmPokerGame).toHaveBeenCalledWith("s1", DATE, "a", { finishDay: false });
  });

  test("finishDay が boolean でなければ 400", async () => {
    const res = await CONFIRM(postReq({ eventDate: DATE, finishDay: "true" }));
    expect(res.status).toBe(400);
    expect(confirmPokerGame).not.toHaveBeenCalled();
  });
});
