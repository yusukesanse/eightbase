import { CS_RULES, DARTS_CS_RULES, MAHJONG_CS_RULES, POKER_CS_RULES, maxAdvanceFor } from "@/lib/gameCsRules";

test("ダーツは2〜4人卓・段は D1〜D3・追加スロー・表彰を書く", () => {
  expect(DARTS_CS_RULES).toMatchObject({ game: "darts", collection: "dartsCsEvents", minSeats: 2, maxSeats: 4,
    maxAdvance: 3, tierLabels: ["D1", "D2", "D3"], scoreLabel: "点数", tiebreakLabel: "追加スロー", writesPodium: true });
  expect(CS_RULES.darts).toBe(DARTS_CS_RULES);
});

test("単位と申告欄の見出しはルール表に持つ（麻雀・ポーカーの文言は今のまま）", () => {
  expect(MAHJONG_CS_RULES.unit).toBe("点");
  expect(POKER_CS_RULES).toMatchObject({ unit: "チップ", reportLabel: "終了時のチップ" });
  expect(DARTS_CS_RULES).toMatchObject({ unit: "点", reportLabel: "カウントアップの点数" });
});

test("ダーツの通過上限: 決勝以外は min(3, 人数−1)、決勝は min(3, 人数)", () => {
  expect(maxAdvanceFor(DARTS_CS_RULES, 2, false)).toBe(1);
  expect(maxAdvanceFor(DARTS_CS_RULES, 4, false)).toBe(3);
  expect(maxAdvanceFor(DARTS_CS_RULES, 2, true)).toBe(2);
  expect(maxAdvanceFor(DARTS_CS_RULES, 4, true)).toBe(3);
});
