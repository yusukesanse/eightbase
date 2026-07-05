import { buildInitialDay } from "./mahjongDay";
import type { RotPlayer } from "./mahjongRotation";

const players = (n: number): RotPlayer[] =>
  Array.from({ length: n }, (_, i) => ({ lineUserId: `p${i + 1}`, displayName: `P${i + 1}` }));

describe("buildInitialDay（2卓固定・最大8名着席）", () => {
  const check = (n: number, tables: number, seated: number, waiting: number) => {
    const r = buildInitialDay(players(n));
    expect(r.tables.length).toBe(tables);
    expect(r.tables.reduce((s, t) => s + t.members.length, 0)).toBe(seated);
    expect(r.waiting.length).toBe(waiting);
  };
  it("4名=1卓・待機0", () => check(4, 1, 4, 0));
  it("8名=2卓・待機0", () => check(8, 2, 8, 0));
  it("9名=2卓・待機1（抜け番開始）", () => check(9, 2, 8, 1));
  it("12名=2卓・待機4", () => check(12, 2, 8, 4));
  it("16名=2卓・待機8（常に最大2卓）", () => check(16, 2, 8, 8));
  it("3名=0卓（開始不可）", () => check(3, 0, 0, 3));
  it("卓ラベルはA/B、待機は先頭8名を除いた順(FIFO)", () => {
    const r = buildInitialDay(players(10));
    expect(r.tables.map((t) => t.label)).toEqual(["A", "B"]);
    expect(r.waiting.map((w) => w.lineUserId)).toEqual(["p9", "p10"]);
  });
});
