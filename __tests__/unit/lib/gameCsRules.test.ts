import { CS_RULES, MAHJONG_CS_RULES, POKER_CS_RULES, maxAdvanceFor } from "@/lib/gameCsRules";

test("麻雀は4人卓・段は M1〜M3・表彰を書かない", () => {
  expect(MAHJONG_CS_RULES).toMatchObject({ game: "mahjong", collection: "mahjongCsEvents", minSeats: 4, maxSeats: 4,
    maxAdvance: 3, tierLabels: ["M1", "M2", "M3"], writesPodium: false });
});

test("ポーカーは2〜6人卓・段は P1〜P3・表彰を書く", () => {
  expect(POKER_CS_RULES).toMatchObject({ game: "poker", collection: "pokerCsEvents", minSeats: 2, maxSeats: 6,
    maxAdvance: 3, tierLabels: ["P1", "P2", "P3"], writesPodium: true });
  expect(CS_RULES.poker).toBe(POKER_CS_RULES);
  expect(CS_RULES.mahjong).toBe(MAHJONG_CS_RULES);
});

test("通過上限は 3 と（卓の人数 − 1）の小さいほう。決勝は 3 と卓の人数の小さいほう", () => {
  expect(maxAdvanceFor(POKER_CS_RULES, 2, false)).toBe(1);
  expect(maxAdvanceFor(POKER_CS_RULES, 3, false)).toBe(2);
  expect(maxAdvanceFor(POKER_CS_RULES, 6, false)).toBe(3);
  expect(maxAdvanceFor(POKER_CS_RULES, 2, true)).toBe(2);
  expect(maxAdvanceFor(POKER_CS_RULES, 5, true)).toBe(3);
  expect(maxAdvanceFor(MAHJONG_CS_RULES, 4, false)).toBe(3);
  expect(maxAdvanceFor(MAHJONG_CS_RULES, 4, true)).toBe(3);
});
