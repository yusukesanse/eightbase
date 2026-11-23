jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
import { getDb } from "@/lib/firebaseAdmin";
import { makeCsDb } from "../../helpers/csDb";
import { fetchPriorityUserIds, hasPlayedLeague, leagueStanding, NON_LEAGUE_RANK } from "@/lib/gameCsLeague";
import { rankSeasonScores } from "@/lib/seasonRanking";

function seedScores(db: ReturnType<typeof makeCsDb>) {
  // 10人ぶん。u1 が最上位、u10 は 0 点（負けて落とした玉が0個）
  for (let i = 1; i <= 10; i++) {
    db._set("scores", `b-s1-${i}`, { seasonId: "s1", gameCategory: "billiards", lineUserId: `u${i}`, totalScore: (10 - i) * 7, displayName: `u${i}` });
  }
  db._set("scores", "other", { seasonId: "s0", gameCategory: "billiards", lineUserId: "old", totalScore: 500 });
}

test("ビリヤード: そのシーズンの scores があれば参加資格あり（0点の人も含む・別シーズンだけの人は不可）", async () => {
  const db = makeCsDb(); seedScores(db); (getDb as jest.Mock).mockReturnValue(db);
  expect(await hasPlayedLeague("billiards", "s1", "u10")).toBe(true);
  expect(await hasPlayedLeague("billiards", "s1", "old")).toBe(false);
  expect(await hasPlayedLeague("billiards", "s1", "nobody")).toBe(false);
});

test("ビリヤード: 段と順位は通算順位から（1〜4=B1・5〜8=B2・9〜=B3。順位なしは B3）", async () => {
  const db = makeCsDb(); seedScores(db); (getDb as jest.Mock).mockReturnValue(db);
  expect(await leagueStanding("billiards", "s1", "u4")).toEqual({ tier: "B1", rank: 4 });
  expect(await leagueStanding("billiards", "s1", "u5")).toEqual({ tier: "B2", rank: 5 });
  expect(await leagueStanding("billiards", "s1", "u8")).toEqual({ tier: "B2", rank: 8 });
  expect(await leagueStanding("billiards", "s1", "u9")).toEqual({ tier: "B3", rank: 9 });
  expect(await leagueStanding("billiards", "s1", "nobody")).toEqual({ tier: "B3", rank: NON_LEAGUE_RANK });
});

test("ビリヤード: 優先枠は通算1〜8位（B1・B2）", async () => {
  const db = makeCsDb(); seedScores(db); (getDb as jest.Mock).mockReturnValue(db);
  expect(await fetchPriorityUserIds("billiards", "s1")).toEqual(["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8"]);
});

test("ビリヤードの並び: 通算pt→1位回数→出場数→名前。他種目の doc は数えない", () => {
  const docs = [
    { lineUserId: "a", gameCategory: "billiards", totalScore: 14, displayName: "あ" },
    { lineUserId: "b", gameCategory: "billiards", totalScore: 28, displayName: "い" },
    { lineUserId: "c", gameCategory: "billiards", totalScore: 14, displayName: "う", details: { dayRank: 1 } },
    { lineUserId: "d", gameCategory: "darts", totalScore: 999, displayName: "え" },
  ];
  expect(rankSeasonScores(docs, "billiards")).toEqual(["b", "c", "a"]);
});
