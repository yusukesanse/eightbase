import { computeNextRound, type RotPlayer, type RankedTable } from "./mahjongRotation";

const P = (id: string): RotPlayer => ({ lineUserId: id, displayName: id });
const T = (label: string, ids: string[]): RankedTable => ({
  label,
  ranked: ids.map((id, i) => ({ player: P(id), rank: i + 1 })),
});
const ids = (arr: RotPlayer[]) => arr.map((p) => p.lineUserId).join(",");

const A = ["a1", "a2", "a3", "a4"];
const B = ["b1", "b2", "b3", "b4"];
const tables = () => [T("A", A), T("B", B)];

describe("computeNextRound（抜け番 B方式）", () => {
  it("9名: 候補2・待機1 → 交代1のみ（縮退）", () => {
    const r = computeNextRound(tables(), [P("w1")]);
    expect(ids(r.out)).toBe("a4"); // 4位・A卓優先
    expect(ids(r.in)).toBe("w1");
    expect(r.shrunk).toBe(true);
    expect(ids(r.waiting)).toBe("a4"); // OUTは末尾へ
    expect(ids(r.tables[0].members)).toBe("a1,a2,a3,w1");
  });

  it("10名: 候補2・待機2 → 交代2", () => {
    const r = computeNextRound(tables(), [P("w1"), P("w2")]);
    expect(ids(r.out)).toBe("a4,b4");
    expect(r.shrunk).toBe(false);
    expect(ids(r.waiting)).toBe("a4,b4");
  });

  it("11名: 候補4・待機3 → 交代3（4位A,B→3位A）", () => {
    const r = computeNextRound(tables(), [P("w1"), P("w2"), P("w3")]);
    expect(ids(r.out)).toBe("a4,b4,a3");
    expect(r.shrunk).toBe(true);
  });

  it("12名: 候補4・待機4 → 交代4（4位A,B→3位A,B）", () => {
    const r = computeNextRound(tables(), [P("w1"), P("w2"), P("w3"), P("w4")]);
    expect(ids(r.out)).toBe("a4,b4,a3,b3");
    expect(r.shrunk).toBe(false);
    expect(ids(r.tables[0].members)).toBe("a1,a2,w1,w3");
    expect(ids(r.tables[1].members)).toBe("b1,b2,w2,w4");
  });

  it("8名: 抜け番なし（従来）", () => {
    const r = computeNextRound(tables(), []);
    expect(r.active).toBe(false);
    expect(r.out).toHaveLength(0);
  });
});
