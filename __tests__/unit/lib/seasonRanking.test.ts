import { rankSeasonScores } from "@/lib/seasonRanking";
import { rankPokerSeason } from "@/lib/pokerStandings";
import { dartsTierForRank } from "@/types/darts";

const docs = [
  { lineUserId: "a", gameCategory: "darts", totalScore: 10.5, displayName: "あ" },
  { lineUserId: "b", gameCategory: "darts", totalScore: 24, displayName: "い" },
  // c は a と同じ通算 15.5pt。1位回数が多いので上
  { lineUserId: "c", gameCategory: "darts", totalScore: 15.5, displayName: "う", details: { dayRank: 1 } },
  { lineUserId: "a", gameCategory: "darts", totalScore: 5, displayName: "あ" },
  // d・e は通算も1位回数も同じ。出場数の多い d が上
  { lineUserId: "d", gameCategory: "darts", totalScore: 3, displayName: "え" },
  { lineUserId: "d", gameCategory: "darts", totalScore: 3, displayName: "え" },
  { lineUserId: "e", gameCategory: "darts", totalScore: 6, displayName: "お" },
  // f・g はすべて同じ。名前順
  { lineUserId: "g", gameCategory: "darts", totalScore: 1, displayName: "き" },
  { lineUserId: "f", gameCategory: "darts", totalScore: 1, displayName: "か" },
  { lineUserId: "p", gameCategory: "poker", totalScore: 99999, displayName: "ぽ" },
];

test("ダーツ: 通算pt（0.5刻み）→1位回数→出場数→名前の順。他種目の doc は数えない", () => {
  expect(rankSeasonScores(docs, "darts")).toEqual(["b", "c", "a", "d", "e", "f", "g"]);
});

test("名前は nameOf があればそちらで比べる（順位表 API は users の名前で並べる）", () => {
  const names: Record<string, string> = { f: "ん", g: "あ" };
  expect(rankSeasonScores(docs, "darts", (uid) => names[uid] ?? "").slice(-2)).toEqual(["g", "f"]);
});

test("ポーカーの並びは変わらない（rankPokerSeason は同じ関数の別名）", () => {
  expect(rankSeasonScores(docs, "poker")).toEqual(["p"]);
  expect(rankPokerSeason(docs)).toEqual(rankSeasonScores(docs, "poker"));
});

test("dartsTierForRank: 1〜4位=D1・5〜8位=D2・9位〜=D3", () => {
  expect([1, 4, 5, 8, 9, 100].map(dartsTierForRank)).toEqual(["D1", "D1", "D2", "D2", "D3", "D3"]);
});
