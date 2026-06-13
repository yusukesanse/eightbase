/**
 * デモ用モックデータ（認証不要の共有UI用）
 * 本番データには一切アクセスしない
 */

import type { MahjongStanding, MahjongTable } from "@/types";

export const MOCK_STANDINGS: MahjongStanding[] = [
  { lineUserId: "u1", displayName: "田中 太郎", gamesPlayed: 8, totalPoints: 271200, average: 33900, rank: 1, tier: "M1", firstCount: 3, top2Count: 5, firstRate: 3/8, top2Rate: 5/8, csEligible: true },
  { lineUserId: "u2", displayName: "佐藤 健", gamesPlayed: 6, totalPoints: 192000, average: 32000, rank: 2, tier: "M1", firstCount: 2, top2Count: 4, firstRate: 2/6, top2Rate: 4/6, csEligible: true },
  { lineUserId: "u3", displayName: "鈴木 一郎", gamesPlayed: 7, totalPoints: 215600, average: 30800, rank: 3, tier: "M1", firstCount: 3, top2Count: 5, firstRate: 3/7, top2Rate: 5/7, csEligible: true },
  { lineUserId: "u4", displayName: "高橋 美咲", gamesPlayed: 5, totalPoints: 144500, average: 28900, rank: 4, tier: "M1", firstCount: 2, top2Count: 3, firstRate: 2/5, top2Rate: 3/5, csEligible: true },
  { lineUserId: "u5", displayName: "伊藤 翔", gamesPlayed: 6, totalPoints: 160200, average: 26700, rank: 5, tier: "M2", firstCount: 2, top2Count: 4, firstRate: 2/6, top2Rate: 4/6, csEligible: true },
  { lineUserId: "u6", displayName: "渡辺 結衣", gamesPlayed: 4, totalPoints: 101600, average: 25400, rank: 6, tier: "M2", firstCount: 1, top2Count: 2, firstRate: 1/4, top2Rate: 2/4, csEligible: false },
  { lineUserId: "u7", displayName: "山本 大輔", gamesPlayed: 8, totalPoints: 196000, average: 24500, rank: 7, tier: "M2", firstCount: 2, top2Count: 4, firstRate: 2/8, top2Rate: 4/8, csEligible: true },
  { lineUserId: "u8", displayName: "中村 蓮", gamesPlayed: 5, totalPoints: 117500, average: 23500, rank: 8, tier: "M2", firstCount: 1, top2Count: 2, firstRate: 1/5, top2Rate: 2/5, csEligible: true },
  { lineUserId: "u9", displayName: "小林 さくら", gamesPlayed: 6, totalPoints: 132000, average: 22000, rank: 9, tier: "M3", firstCount: 1, top2Count: 3, firstRate: 1/6, top2Rate: 3/6, csEligible: true },
  { lineUserId: "u10", displayName: "加藤 悠真", gamesPlayed: 3, totalPoints: 63000, average: 21000, rank: 10, tier: "M3", firstCount: 0, top2Count: 1, firstRate: 0/3, top2Rate: 1/3, csEligible: false },
  { lineUserId: "u11", displayName: "吉田 葵", gamesPlayed: 4, totalPoints: 78000, average: 19500, rank: 11, tier: "M3", firstCount: 0, top2Count: 1, firstRate: 0/4, top2Rate: 1/4, csEligible: false },
  { lineUserId: "u12", displayName: "山田 隼人", gamesPlayed: 5, totalPoints: 92500, average: 18500, rank: 12, tier: "M3", firstCount: 0, top2Count: 1, firstRate: 0/5, top2Rate: 1/5, csEligible: true },
];

export const MOCK_TABLES: MahjongTable[] = [
  {
    tableId: "t1",
    seasonId: "demo",
    eventDate: "2026-06-13",
    createdBy: "u1",
    memberIds: ["u1", "u2", "u3", "u4"],
    members: [
      { lineUserId: "u1", displayName: "田中 太郎", points: 41200, rank: 1, reportedAt: "2026-06-13T12:00:00Z" },
      { lineUserId: "u2", displayName: "佐藤 健", points: 28800, rank: 2, reportedAt: "2026-06-13T12:01:00Z" },
      { lineUserId: "u3", displayName: "鈴木 一郎", points: 19000, rank: 3, reportedAt: "2026-06-13T12:02:00Z" },
      { lineUserId: "u4", displayName: "高橋 美咲", points: 11000, rank: 4, reportedAt: "2026-06-13T12:03:00Z" },
    ],
    status: "completed",
    createdAt: "2026-06-13T10:00:00Z",
    updatedAt: "2026-06-13T12:03:00Z",
  },
  {
    tableId: "t2",
    seasonId: "demo",
    eventDate: "2026-06-13",
    createdBy: "u5",
    memberIds: ["u5", "u6", "u7", "u8"],
    members: [
      { lineUserId: "u5", displayName: "伊藤 翔", points: 35000, rank: 1, reportedAt: "2026-06-13T12:10:00Z" },
      { lineUserId: "u6", displayName: "渡辺 結衣", points: 27000, rank: 2, reportedAt: "2026-06-13T12:11:00Z" },
      { lineUserId: "u7", displayName: "山本 大輔", points: null, rank: null, reportedAt: null },
      { lineUserId: "u8", displayName: "中村 蓮", points: null, rank: null, reportedAt: null },
    ],
    status: "reporting",
    createdAt: "2026-06-13T11:00:00Z",
    updatedAt: "2026-06-13T12:11:00Z",
  },
];

/** 卓作成デモで選べるメンバー */
export const MOCK_MEMBERS = MOCK_STANDINGS.map((s) => ({
  lineUserId: s.lineUserId,
  displayName: s.displayName,
}));

/** デモでの「自分」 */
export const MOCK_ME = { lineUserId: "u9", displayName: "小林 さくら" };
