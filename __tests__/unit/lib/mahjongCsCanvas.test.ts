import {
  incomingCount, openSeats, canvasToRounds, unplacedIds, initialCanvasDraft,
  addTable, removeTable, moveTable, connect, disconnect, setTableAdvance,
  placePlayer, removePlayer, toggleSeed, setTierSeeds, fillEmptySeats,
  type CanvasDraft,
} from "@/lib/mahjongCsCanvas";
import { validateBracket } from "@/lib/mahjongCsBracket";
import type { MahjongCsCanvasTable, MahjongCsEntrant } from "@/types";

const table = (id: string, to: string | null = null, extra: Partial<MahjongCsCanvasTable> = {}): MahjongCsCanvasTable =>
  ({ id, to, x: 0, y: 0, advanceCount: 1, playerIds: [], ...extra });
const draft = (...tables: MahjongCsCanvasTable[]): CanvasDraft => ({ seedUserIds: [], tables });
const ticket = (fromMatchId: string, place: number) => ({ kind: "ticket", fromMatchId, place });

describe("canvasToRounds", () => {
  it("卓0件", () => {
    expect(canvasToRounds([])).toEqual({ rounds: [], errors: ["卓がありません"] });
  });
  it.each([
    [[table("a"), table("b")], "決勝（矢印が出ていない卓）は1つにしてください（今 2 卓）"],
    [[table("a", "b"), table("b", "a"), table("f")], "矢印が輪になっています"],
    [[table("a", "missing"), table("f")], "卓: 矢印の先の卓がありません"],
    [[table("a", "a"), table("f")], "卓: 矢印の先の卓がありません"],
  ])("グラフ不正ならラウンドを返さない: %j", (tables, error) => {
    const out = canvasToRounds(tables);
    expect(out.rounds).toEqual([]);
    expect(out.errors).toContain(error);
  });
  it("席超過でも計算したラウンドを返す", () => {
    const out = canvasToRounds([table("a", "f", { advanceCount: 2 }), table("b", "f", { advanceCount: 2 }), table("f", null, { playerIds: ["seed"] })]);
    expect(out.errors).toEqual(["決勝卓: 席が足りません（5名入ります）"]);
    expect(out.rounds[1].matches[0].seats).toHaveLength(5);
  });
  it.each([0, 4, 1.5])("勝ち抜け人数 %s は卓名付きで検証する", (advanceCount) => {
    const out = canvasToRounds([table("f", null, { advanceCount })]);
    expect(out.errors).toEqual(["決勝卓: 勝ち抜け人数は1〜3名にしてください"]);
    expect(out.rounds).toHaveLength(1);
  });
  it("12卓→3卓→決勝を深さ・左右順で編成する", () => {
    const tables = [table("f", null, { advanceCount: 3, playerIds: ["seed"] }),
      ...Array.from({ length: 3 }, (_, i) => table(`s${i}`, "f", { x: i })),
      ...Array.from({ length: 12 }, (_, i) => table(`p${i}`, `s${Math.floor(i / 4)}`, { x: i, playerIds: Array.from({ length: 4 }, (_, j) => `u${i}-${j}`) }))].reverse();
    const before = JSON.stringify(tables);
    const out = canvasToRounds(tables);
    expect(out.errors).toEqual([]);
    expect(out.rounds.map((r) => r.label)).toEqual(["準々決勝", "準決勝", "決勝"]);
    expect(out.rounds[0].matches.map((m) => m.label)).toEqual(Array.from({ length: 12 }, (_, i) => `準々決勝${String.fromCharCode(65 + i)}卓`));
    expect(out.rounds[1].matches[0].seats).toEqual([0, 1, 2, 3].map((i) => ticket(`p${i}`, 1)));
    expect(validateBracket(out.rounds, tables.flatMap((t) => t.playerIds))).toEqual([]);
    expect(JSON.stringify(tables)).toBe(before);
  });
  it.each([3, 4])("最大depth %s の予選名", (depth) => {
    const out = canvasToRounds(Array.from({ length: depth + 1 }, (_, i) => table(`${i}`, i === 0 ? null : `${i - 1}`)));
    expect(out.rounds.map((r) => r.label)).toEqual(depth === 3
      ? ["予選", "準々決勝", "準決勝", "決勝"]
      : ["予選1回戦", "予選2回戦", "準々決勝", "準決勝", "決勝"]);
    expect(out.rounds.map((r) => r.type)).toEqual([...Array(depth).fill("prelim"), "final"]);
  });
  it("同じxはid順で、Zの次はAA卓", () => {
    const out = canvasToRounds([table("f"), ...Array.from({ length: 27 }, (_, i) => table(`p${String(i).padStart(2, "0")}`, "f")).reverse()]);
    expect(out.rounds[0].matches[26]).toMatchObject({ matchId: "p26", label: "準決勝AA卓" });
    expect(out.rounds[1].matches[0].seats![0]).toEqual(ticket("p00", 1));
  });
  it("シード直置きは札の後に入り、足りない席はnull", () => {
    const tables = [table("a", "f", { advanceCount: 2, playerIds: ["a", "b", "c", "d"] }), table("f", null, { advanceCount: 3, playerIds: ["s1", "s2"] })];
    const out = canvasToRounds(tables);
    expect(out.errors).toEqual([]);
    expect(out.rounds[1].matches[0]).toEqual({ matchId: "f", label: "決勝卓", players: [], status: "reporting", advanceCount: 3,
      seats: [ticket("a", 1), ticket("a", 2), { kind: "player", lineUserId: "s1" }, { kind: "player", lineUserId: "s2" }] });
    expect(validateBracket(out.rounds, ["a", "b", "c", "d", "s1", "s2"])).toEqual([]);
    expect(canvasToRounds([table("f")]).rounds[0].matches[0].seats).toEqual([null, null, null, null]);
  });
});

describe("キャンバス編集", () => {
  it("入ってくる人数と空席は負数も返す", () => {
    const tables = [table("a", "f", { advanceCount: 3 }), table("b", "f", { advanceCount: 2 }), table("f", null, { playerIds: ["u"] })];
    expect(incomingCount(tables, "f")).toBe(5);
    expect(openSeats(tables, "f")).toBe(-2);
  });
  it("初期値と未配置を取得し、返した配列は入力と共有しない", () => {
    expect(initialCanvasDraft({})).toEqual(draft());
    expect(initialCanvasDraft({ bracket: { seedUserIds: ["s"], rounds: [] } })).toEqual({ seedUserIds: ["s"], tables: [] });
    const d = { seedUserIds: ["s"], tables: [table("a", null, { playerIds: ["u"] })] };
    const out = initialCanvasDraft({ bracket: { ...d, rounds: [], canvas: { tables: d.tables } } });
    out.tables[0].playerIds.push("x");
    out.seedUserIds.push("x");
    expect(d.seedUserIds).toEqual(["s"]);
    expect(d.tables[0].playerIds).toEqual(["u"]);
    expect(unplacedIds(d, ["u", "s", "v"])).toEqual(["s", "v"]);
  });
  it("追加・移動・削除・切断と通過人数の変更", () => {
    const d = draft(table("a", "b"), table("b"));
    expect(addTable(d, "c", 10, 20, 2).tables[2]).toEqual(table("c", null, { x: 10, y: 20, advanceCount: 2 }));
    expect(addTable(d, "a", 10, 20, 2)).toEqual(d);
    expect(moveTable(d, "a", 10, 20).tables[0]).toMatchObject({ x: 10, y: 20 });
    expect(removeTable(d, "b").tables).toEqual([table("a")]);
    expect(disconnect(d, "a").tables[0].to).toBeNull();
    expect(setTableAdvance(d, "a", 3).tables[0].advanceCount).toBe(3);
    for (const n of [0, 4, 1.5]) expect(setTableAdvance(d, "a", n)).toEqual(d);
  });
  it("接続は置き換え、自己・存在しないid・輪は拒否し、席超過は許す", () => {
    const d = draft(table("a", "b"), table("b", "c"), table("c"));
    expect(connect(d, "a", "c").tables[0].to).toBe("c");
    for (const [from, to] of [["a", "a"], ["a", "x"], ["x", "a"], ["c", "a"]]) expect(connect(d, from, to)).toEqual(d);
    const full = draft(table("a"), table("b", null, { playerIds: ["1", "2", "3", "4"] }));
    expect(connect(full, "a", "b").tables[0].to).toBe("b");
  });
  it("人を他卓から末尾へ移動し満席・不存在は拒否する", () => {
    const d = draft(table("a", null, { playerIds: ["u"] }), table("b", null, { playerIds: ["v"] }));
    expect(placePlayer(d, "u", "b").tables.map((t) => t.playerIds)).toEqual([[], ["v", "u"]]);
    expect(placePlayer(d, "u", "missing")).toEqual(d);
    const full = draft(table("a", "b", { advanceCount: 3, playerIds: ["u"] }), table("b", null, { playerIds: ["v"] }));
    expect(placePlayer(full, "u", "b")).toEqual(full);
    expect(removePlayer(d, "u").tables[0].playerIds).toEqual([]);
  });
  it("シードの切替とリーグ別一括設定", () => {
    const d = { seedUserIds: ["other", "a"], tables: [] };
    const entrants: MahjongCsEntrant[] = ["a", "b", "c"].map((id, i) => ({ lineUserId: id, displayName: id, rank: i, seed: false, tier: i === 2 ? "M2" : "M1" }));
    expect(toggleSeed(d, "a").seedUserIds).toEqual(["other"]);
    expect(toggleSeed(d, "b").seedUserIds).toEqual(["other", "a", "b"]);
    expect(setTierSeeds(d, entrants, "M1", true).seedUserIds).toEqual(["other", "a", "b"]);
    expect(setTierSeeds(d, entrants, "M1", false).seedUserIds).toEqual(["other"]);
    expect(setTierSeeds(d, entrants, "M2", true).seedUserIds).toEqual(["other", "a", "c"]);
  });
  it("未配置の非シードだけを流入のない卓のy降順・x昇順へ入れる", () => {
    const d = { seedUserIds: ["seed"], tables: [table("top", "f", { y: 0 }), table("right", "f", { y: 10, x: 20 }), table("left", "f", { y: 10, x: 0, playerIds: ["placed"] }), table("f")] };
    const ids = ["seed", "placed", ...Array.from({ length: 12 }, (_, i) => `${i}`)];
    const out = fillEmptySeats(d, ids);
    expect(out.tables.map((t) => t.playerIds)).toEqual([["7", "8", "9", "10"], ["3", "4", "5", "6"], ["placed", "0", "1", "2"], []]);
    expect(unplacedIds(out, ids)).toEqual(["seed", "11"]);
  });
  it("編集関数はすべて入力を変更せず独立したコピーを返す", () => {
    const d = { seedUserIds: ["s"], tables: [table("a", "b", { playerIds: ["u"] }), table("b")] };
    const before = JSON.stringify(d);
    const outputs = [addTable(d, "c", 1, 2, 1), addTable(d, "a", 1, 2, 1), removeTable(d, "b"), moveTable(d, "a", 1, 2), connect(d, "a", "b"), connect(d, "b", "a"), disconnect(d, "a"), setTableAdvance(d, "a", 2), setTableAdvance(d, "a", 0), placePlayer(d, "u", "b"), removePlayer(d, "u"), toggleSeed(d, "s"), setTierSeeds(d, [], "M1", true), fillEmptySeats(d, ["u", "v"])];
    for (const out of outputs) {
      out.seedUserIds.push("changed");
      out.tables[0].playerIds.push("changed");
    }
    expect(JSON.stringify(d)).toBe(before);
  });
});
