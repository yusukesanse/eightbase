/**
 * 単体テスト: src/lib/mahjong.ts computeStandings の順位方式（average / total）。
 * 完了卓を getDb モックで与え、metricOverride で並び順が切り替わることを検証する。
 */
import type { MahjongTable } from "@/types";

const mockGet = jest.fn();
jest.mock("@/lib/firebaseAdmin", () => ({
  getDb: () => ({
    collection: () => ({ where: () => ({ get: mockGet }) }),
  }),
}));

import { computeStandings, normalizeRankingMetric } from "@/lib/mahjong";

function tableDoc(members: { id: string; points: number; rank: number }[]) {
  const t: Partial<MahjongTable> = {
    seasonId: "s1",
    status: "completed",
    members: members.map((m) => ({
      lineUserId: m.id,
      displayName: m.id,
      pictureUrl: "",
      points: m.points,
      rank: m.rank,
      reportedAt: "2026-07-01T00:00:00.000Z",
    })),
  };
  return { data: () => t };
}

// A: 2戦 合計60000 平均30000 / B: 1戦 合計40000 平均40000 / C: 1戦 20000
function setTables() {
  mockGet.mockResolvedValue({
    docs: [
      tableDoc([{ id: "A", points: 30000, rank: 1 }, { id: "C", points: 20000, rank: 2 }]),
      tableDoc([{ id: "A", points: 30000, rank: 1 }]),
      tableDoc([{ id: "B", points: 40000, rank: 1 }]),
    ],
  });
}

describe("computeStandings — 順位方式(average/total)", () => {
  beforeEach(() => setTables());

  test("normalizeRankingMetric: total 以外は average", () => {
    expect(normalizeRankingMetric("total")).toBe("total");
    expect(normalizeRankingMetric("average")).toBe("average");
    expect(normalizeRankingMetric(undefined)).toBe("average");
    expect(normalizeRankingMetric("xxx")).toBe("average");
  });

  test("average 方式: 平均点降順（B 40000 > A 30000 > C 20000）", async () => {
    const s = await computeStandings("s1", "average");
    const rank = Object.fromEntries(s.map((x) => [x.lineUserId, x.rank]));
    expect(rank.B).toBe(1);
    expect(rank.A).toBe(2);
    expect(rank.C).toBe(3);
    // 集計値の確認
    const a = s.find((x) => x.lineUserId === "A")!;
    expect(a.gamesPlayed).toBe(2);
    expect(a.totalPoints).toBe(60000);
    expect(a.average).toBe(30000);
  });

  test("total 方式: 合計点降順（A 60000 > B 40000 > C 20000）＝averageと順位が入れ替わる", async () => {
    const s = await computeStandings("s1", "total");
    const rank = Object.fromEntries(s.map((x) => [x.lineUserId, x.rank]));
    expect(rank.A).toBe(1);
    expect(rank.B).toBe(2);
    expect(rank.C).toBe(3);
  });
});
