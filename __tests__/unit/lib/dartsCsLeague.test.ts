jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
import { getDb } from "@/lib/firebaseAdmin";
import { makeCsDb } from "../../helpers/csDb";
import { fetchPriorityUserIds, hasPlayedLeague, leagueStanding, NON_LEAGUE_RANK } from "@/lib/gameCsLeague";

function seedScores(db: ReturnType<typeof makeCsDb>) {
  // 10人ぶん。u1 が最上位、u10 が最下位
  for (let i = 1; i <= 10; i++) {
    db._set("scores", `g-s1-${i}`, { seasonId: "s1", gameCategory: "darts", lineUserId: `u${i}`, totalScore: 24 - i * 0.5, displayName: `u${i}` });
  }
  db._set("scores", "other", { seasonId: "s0", gameCategory: "darts", lineUserId: "old", totalScore: 500 });
}

test("ダーツ: そのシーズンの scores があれば参加資格あり（別シーズンだけの人は不可）", async () => {
  const db = makeCsDb(); seedScores(db); (getDb as jest.Mock).mockReturnValue(db);
  expect(await hasPlayedLeague("darts", "s1", "u3")).toBe(true);
  expect(await hasPlayedLeague("darts", "s1", "old")).toBe(false);
  expect(await hasPlayedLeague("darts", "s1", "nobody")).toBe(false);
});

test("ダーツ: 段と順位は通算順位から（1〜4=D1・5〜8=D2・9〜=D3。順位なしは D3）", async () => {
  const db = makeCsDb(); seedScores(db); (getDb as jest.Mock).mockReturnValue(db);
  expect(await leagueStanding("darts", "s1", "u4")).toEqual({ tier: "D1", rank: 4 });
  expect(await leagueStanding("darts", "s1", "u5")).toEqual({ tier: "D2", rank: 5 });
  expect(await leagueStanding("darts", "s1", "u8")).toEqual({ tier: "D2", rank: 8 });
  expect(await leagueStanding("darts", "s1", "u9")).toEqual({ tier: "D3", rank: 9 });
  expect(await leagueStanding("darts", "s1", "nobody")).toEqual({ tier: "D3", rank: NON_LEAGUE_RANK });
});

test("ダーツ: 優先枠は通算1〜8位（D1・D2）", async () => {
  const db = makeCsDb(); seedScores(db); (getDb as jest.Mock).mockReturnValue(db);
  expect(await fetchPriorityUserIds("darts", "s1")).toEqual(["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8"]);
});
