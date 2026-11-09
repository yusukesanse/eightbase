import { rankPokerSeason } from "@/lib/pokerStandings";

test("通算チップ→1位回数→参加日数→名前の順に並べ、ポーカー以外は数えない", () => {
  const docs = [
    { lineUserId: "a", gameCategory: "poker", totalScore: 100, displayName: "あ" },
    { lineUserId: "b", gameCategory: "poker", totalScore: 300, displayName: "い" },
    { lineUserId: "c", gameCategory: "poker", totalScore: 100, displayName: "う", details: { dayRank: 1 } },
    { lineUserId: "d", gameCategory: "darts", totalScore: 999, displayName: "え" },
    { lineUserId: "a", gameCategory: "poker", totalScore: 0, displayName: "あ" },
  ];
  expect(rankPokerSeason(docs)).toEqual(["b", "c", "a"]);
});
