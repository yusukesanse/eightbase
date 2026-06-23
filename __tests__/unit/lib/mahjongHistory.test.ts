/**
 * 単体テスト: src/lib/mahjong.ts computePlayerHistory
 * mahjongTables を getDb モックで与え、プレイヤー戦歴の集計を検証する。
 */
import type { MahjongTable } from "@/types";

const mockGet = jest.fn();
jest.mock("@/lib/firebaseAdmin", () => ({
  getDb: () => ({
    collection: () => ({ where: () => ({ get: mockGet }) }),
  }),
}));

import { computePlayerHistory } from "@/lib/mahjong";

function table(
  tableId: string,
  eventDate: string,
  round: number,
  status: MahjongTable["status"],
  members: { id: string; points: number | null; rank: number | null }[]
): { id: string; data: () => MahjongTable } {
  const t: MahjongTable = {
    tableId,
    seasonId: "s1",
    eventDate,
    createdBy: "system",
    memberIds: members.map((m) => m.id),
    members: members.map((m) => ({
      lineUserId: m.id,
      displayName: m.id.toUpperCase(),
      pictureUrl: "",
      points: m.points,
      rank: m.rank,
      reportedAt: m.points === null ? null : `${eventDate}T09:00:00.000Z`,
    })),
    status,
    round,
    createdAt: `${eventDate}T08:00:00.000Z`,
    updatedAt: `${eventDate}T09:00:00.000Z`,
  };
  return { id: tableId, data: () => t };
}

describe("computePlayerHistory — プレイヤー戦歴", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue({
      docs: [
        table("tA", "2026-07-11", 1, "completed", [
          { id: "you", points: 38200, rank: 1 },
          { id: "u2", points: 27600, rank: 2 },
          { id: "u3", points: 19800, rank: 3 },
          { id: "u4", points: 14400, rank: 4 },
        ]),
        table("tB", "2026-08-08", 1, "completed", [
          { id: "you", points: 25000, rank: 2 },
          { id: "u2", points: 40000, rank: 1 },
          { id: "u3", points: 20000, rank: 3 },
          { id: "u4", points: 15000, rank: 4 },
        ]),
        // reporting（未完了）は除外されるべき
        table("tC", "2026-09-05", 1, "reporting", [
          { id: "you", points: null, rank: null },
          { id: "u2", points: null, rank: null },
          { id: "u3", points: null, rank: null },
          { id: "u4", points: null, rank: null },
        ]),
      ],
    });
  });

  test("完了卓のみを戦歴に含め、新しい順で返す", async () => {
    const h = await computePlayerHistory("s1", "you");
    expect(h.games).toHaveLength(2); // reporting の tC は除外
    expect(h.games[0].eventDate).toBe("2026-08-08"); // 新しい順
    expect(h.games[0]).toMatchObject({ tableId: "tB", points: 25000, rank: 2 });
    expect(h.games[1]).toMatchObject({ tableId: "tA", points: 38200, rank: 1 });
  });

  test("avgTrend は時系列（古い順）の累積アベレージ", async () => {
    const h = await computePlayerHistory("s1", "you");
    expect(h.avgTrend).toEqual([
      { date: "2026-07-11", cumulativeAverage: 38200 },
      { date: "2026-08-08", cumulativeAverage: 31600 }, // (38200+25000)/2
    ]);
  });

  test("standing は standings と一致（集計・順位）", async () => {
    const h = await computePlayerHistory("s1", "you");
    expect(h.standing).not.toBeNull();
    expect(h.standing).toMatchObject({
      gamesPlayed: 2,
      average: 31600,
      firstCount: 1,
      top2Count: 2,
    });
    // u2 は平均 33800 で you(31600) より上 → you は2位
    expect(h.standing?.rank).toBe(2);
  });

  test("完了卓に出場していないプレイヤーは standing=null・games空", async () => {
    const h = await computePlayerHistory("s1", "nobody");
    expect(h.standing).toBeNull();
    expect(h.games).toHaveLength(0);
    expect(h.avgTrend).toHaveLength(0);
  });
});
