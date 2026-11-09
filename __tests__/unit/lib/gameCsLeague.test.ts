jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
import { getDb } from "@/lib/firebaseAdmin";
import { makeCsDb } from "../../helpers/csDb";
import { fetchPriorityUserIds, hasPlayedLeague, leagueStanding, NON_LEAGUE_RANK } from "@/lib/gameCsLeague";

function seedScores(db: ReturnType<typeof makeCsDb>) {
  // 10人ぶん。u1 が最上位、u10 が最下位
  for (let i = 1; i <= 10; i++) {
    db._set("scores", `g-s1-${i}`, { seasonId: "s1", gameCategory: "poker", lineUserId: `u${i}`, totalScore: 1000 - i, displayName: `u${i}` });
  }
  db._set("scores", "other", { seasonId: "s0", gameCategory: "poker", lineUserId: "old", totalScore: 5000 });
}

test("ポーカー: そのシーズンの scores があれば参加資格あり。読むのは1件だけ", async () => {
  const db = makeCsDb(); seedScores(db); (getDb as jest.Mock).mockReturnValue(db);
  expect(await hasPlayedLeague("poker", "s1", "u3")).toBe(true);
  expect(await hasPlayedLeague("poker", "s1", "old")).toBe(false);
  expect(await hasPlayedLeague("poker", "s1", "nobody")).toBe(false);
});

test("ポーカー: 段と順位は通算順位から（1〜4=P1・5〜8=P2・9〜=P3）", async () => {
  const db = makeCsDb(); seedScores(db); (getDb as jest.Mock).mockReturnValue(db);
  expect(await leagueStanding("poker", "s1", "u2")).toEqual({ tier: "P1", rank: 2 });
  expect(await leagueStanding("poker", "s1", "u8")).toEqual({ tier: "P2", rank: 8 });
  expect(await leagueStanding("poker", "s1", "u9")).toEqual({ tier: "P3", rank: 9 });
  expect(await leagueStanding("poker", "s1", "nobody")).toEqual({ tier: "P3", rank: NON_LEAGUE_RANK });
});

test("ポーカー: 優先枠は通算1〜8位", async () => {
  const db = makeCsDb(); seedScores(db); (getDb as jest.Mock).mockReturnValue(db);
  expect(await fetchPriorityUserIds("poker", "s1")).toEqual(["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8"]);
});

test("麻雀: 優先枠は最新の確定編成の M1・M2（今の挙動のまま）", async () => {
  const db = makeCsDb(); (getDb as jest.Mock).mockReturnValue(db);
  db._set("mahjongLeagueAssignments", "old", { seasonId: "s1", confirmedAt: "2026-01-01", entries: [{ lineUserId: "x", tier: "M1", rank: 1 }] });
  db._set("mahjongLeagueAssignments", "new", { seasonId: "s1", confirmedAt: "2026-02-01", entries: [
    { lineUserId: "a", tier: "M1", rank: 1 }, { lineUserId: "b", tier: "M2", rank: 5 }, { lineUserId: "c", tier: "M3", rank: 9 }] });
  expect(await fetchPriorityUserIds("mahjong", "s1")).toEqual(["a", "b"]);
  expect(await leagueStanding("mahjong", "s1", "c")).toEqual({ tier: "M3", rank: 9 });
  expect(await leagueStanding("mahjong", "s1", "z")).toEqual({ tier: "M3", rank: NON_LEAGUE_RANK });
});
