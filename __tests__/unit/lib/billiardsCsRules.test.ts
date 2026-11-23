import { BILLIARDS_CS_RULES, CS_RULES, DARTS_CS_RULES, MAHJONG_CS_RULES, POKER_CS_RULES, maxAdvanceFor } from "@/lib/gameCsRules";

test("ビリヤードは2人卓・勝者1名が通過・段は B1〜B3・敗者の矢印あり・勝者を申告・表彰を書く", () => {
  expect(BILLIARDS_CS_RULES).toMatchObject({ game: "billiards", collection: "billiardsCsEvents", minSeats: 2, maxSeats: 2,
    maxAdvance: 1, tierLabels: ["B1", "B2", "B3"], writesPodium: true, loserArrow: true, report: "winner" });
  expect(CS_RULES.billiards).toBe(BILLIARDS_CS_RULES);
});

test("敗者の矢印と勝者申告はビリヤードだけ（麻雀・ポーカー・ダーツは今の動き）", () => {
  for (const rules of [MAHJONG_CS_RULES, POKER_CS_RULES, DARTS_CS_RULES]) {
    expect(rules.loserArrow).toBeUndefined();
    expect(rules.report).toBeUndefined();
  }
});

test("ビリヤードの通過上限は決勝でも1名（勝者だけ）", () => {
  expect(maxAdvanceFor(BILLIARDS_CS_RULES, 2, false)).toBe(1);
  expect(maxAdvanceFor(BILLIARDS_CS_RULES, 2, true)).toBe(1);
});
