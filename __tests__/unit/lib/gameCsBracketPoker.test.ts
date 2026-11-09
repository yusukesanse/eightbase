import { validateBracket } from "@/lib/mahjongCsBracket";
import { canvasToRounds, fillEmptySeats, openSeats, placePlayer, type CanvasDraft } from "@/lib/mahjongCsCanvas";
import { POKER_CS_RULES } from "@/lib/gameCsRules";
import type { MahjongCsCanvasTable } from "@/types";

const t = (id: string, playerIds: string[], to: string | null, advanceCount = 1, x = 0): MahjongCsCanvasTable =>
  ({ id, x, y: 0, advanceCount, to, playerIds });

test("ポーカーは卓の空席が6つ", () => {
  expect(openSeats([t("A", ["a", "b"], null)], "A", POKER_CS_RULES.maxSeats)).toBe(4);
});

test("ポーカーは6名を超えて置けない", () => {
  let d: CanvasDraft = { seedUserIds: [], tables: [t("A", ["1", "2", "3", "4", "5", "6"], null)] };
  d = placePlayer(d, "7", "A", POKER_CS_RULES.maxSeats);
  expect(d.tables[0].playerIds).toHaveLength(6);
});

test("ポーカーの3名卓→2名卓（決勝）は確定できる", () => {
  const tables = [t("P", ["a", "b", "c"], "F", 1), t("F", ["d"], null, 2)];
  const { rounds, errors } = canvasToRounds(tables, POKER_CS_RULES);
  expect(errors).toEqual([]);
  expect(rounds[0].matches[0].seats).toHaveLength(3);
  expect(rounds[1].matches[0].seats).toHaveLength(2);
  expect(validateBracket(rounds, ["a", "b", "c", "d"], POKER_CS_RULES)).toEqual([]);
});

test("ポーカーで7名入る卓は確定できない", () => {
  const tables = [t("P", ["a", "b", "c", "d", "e"], "F", 3), t("F", ["f", "g", "h", "i"], null, 3)];
  const { errors } = canvasToRounds(tables, POKER_CS_RULES);
  expect(errors.join("\n")).toContain("席が足りません（7名入ります）");
});

test("ポーカーで1名だけの卓は確定できない", () => {
  const tables = [t("F", ["a"], null, 1)];
  const { rounds, errors } = canvasToRounds(tables, POKER_CS_RULES);
  const all = [...errors, ...validateBracket(rounds, ["a"], POKER_CS_RULES)];
  expect(all.join("\n")).toContain("空いている席があります");
});

test("ポーカーの2名卓（決勝以外）は通過1名まで", () => {
  const tables = [t("P", ["a", "b"], "F", 2), t("F", ["c"], null, 1)];
  const { rounds } = canvasToRounds(tables, POKER_CS_RULES);
  expect(validateBracket(rounds, ["a", "b", "c"], POKER_CS_RULES).join("\n"))
    .toContain("勝ち抜け人数は卓の人数より少なくしてください");
});

test("未配置の人を空席に入れるときもポーカーの席数を使う", () => {
  const d = fillEmptySeats({ seedUserIds: [], tables: [t("A", [], null)] }, ["1", "2", "3", "4", "5", "6", "7"], POKER_CS_RULES.maxSeats);
  expect(d.tables[0].playerIds).toHaveLength(6);
});

test("ポーカーの2名卓（決勝）は通過2名まで。文言は「卓の人数以下」", () => {
  const tables = [t("P", ["a", "b", "c"], "F", 1), t("F", ["d"], null, 3)];
  const { rounds } = canvasToRounds(tables, POKER_CS_RULES);
  const errors = validateBracket(rounds, ["a", "b", "c", "d"], POKER_CS_RULES);
  expect(errors).toContain("決勝卓: 勝ち抜け人数は卓の人数以下にしてください");
  expect(errors.join("\n")).not.toContain("卓の人数より少なく");
});
