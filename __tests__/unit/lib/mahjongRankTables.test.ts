/**
 * 単体テスト: src/lib/mahjong.ts rankTablesToStandings（当日順位/通算順位で共有する集計コア）。
 * 複数半荘の合算・タイブレーク・metric(total/average) を検証する（DBアクセスなしの純関数）。
 */
import type { MahjongTable } from "@/types";
import { rankTablesToStandings } from "@/lib/mahjong";

function table(members: { id: string; points: number; rank: number }[], status = "completed"): MahjongTable {
  return {
    tableId: "t",
    seasonId: "s1",
    eventDate: "2026-03-15",
    createdBy: "system",
    memberIds: members.map((m) => m.id),
    members: members.map((m) => ({
      lineUserId: m.id,
      displayName: m.id,
      pictureUrl: "",
      points: m.points,
      rank: m.rank,
      reportedAt: "2026-03-15T00:00:00.000Z",
    })),
    status: status as MahjongTable["status"],
    createdAt: "",
    updatedAt: "",
  };
}

describe("rankTablesToStandings", () => {
  // A: 2半荘 合計60000 平均30000 / B: 1半荘 40000 / C: 1半荘 20000
  const tables = [
    table([{ id: "A", points: 30000, rank: 1 }, { id: "C", points: 20000, rank: 2 }]),
    table([{ id: "A", points: 30000, rank: 1 }]),
    table([{ id: "B", points: 40000, rank: 1 }]),
  ];

  test("average 方式: 平均降順（B > A > C）", () => {
    const s = rankTablesToStandings(tables, "average");
    const rank = Object.fromEntries(s.map((x) => [x.lineUserId, x.rank]));
    expect(rank.B).toBe(1);
    expect(rank.A).toBe(2);
    expect(rank.C).toBe(3);
    const a = s.find((x) => x.lineUserId === "A")!;
    expect(a.gamesPlayed).toBe(2); // 当日の半荘数
    expect(a.totalPoints).toBe(60000);
    expect(a.average).toBe(30000);
  });

  test("total 方式: 合計降順（A > B > C）＝averageと入れ替わる", () => {
    const s = rankTablesToStandings(tables, "total");
    const rank = Object.fromEntries(s.map((x) => [x.lineUserId, x.rank]));
    expect(rank.A).toBe(1);
    expect(rank.B).toBe(2);
    expect(rank.C).toBe(3);
  });

  test("completed 以外の卓は集計しない", () => {
    const s = rankTablesToStandings(
      [table([{ id: "X", points: 50000, rank: 1 }], "reporting")],
      "average"
    );
    expect(s).toHaveLength(0);
  });

  test("同点(平均)は連対率→試合数→名前でタイブレーク", () => {
    // D と E は平均同点(30000)。D は連対率1.0(2半荘とも2位以内)、E は 0.5。
    const t = [
      table([{ id: "D", points: 30000, rank: 2 }, { id: "E", points: 40000, rank: 1 }]),
      table([{ id: "D", points: 30000, rank: 2 }, { id: "E", points: 20000, rank: 4 }]),
    ];
    const s = rankTablesToStandings(t, "average");
    const rank = Object.fromEntries(s.map((x) => [x.lineUserId, x.rank]));
    expect(rank.D).toBe(1); // 同平均だが連対率で D が上
    expect(rank.E).toBe(2);
  });
});
