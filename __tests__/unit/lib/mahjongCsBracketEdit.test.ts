import {
  initialDraft, addRound, removeRound, renameRound, setAdvanceCount, addTable, removeTable,
  placeChip, clearSeat, availableTickets, toggleSeed, setTierSeeds, fillEmptySeats,
} from "@/lib/mahjongCsBracketEdit";
import type { Draft, Chip } from "@/lib/mahjongCsBracketEdit";
import type { MahjongCsEntrant } from "@/types";

const player: Chip = { kind: "player", lineUserId: "p1" };
const ticket: Chip = { kind: "ticket", fromMatchId: "a", place: 2 };
// 依存する札と既存の参加者を含む編成を作る。
function fixture(): Draft {
  return {
    seedUserIds: ["seed"],
    rounds: [
      { type: "prelim", label: "予選", advanceCount: 2, matches: [
        { matchId: "a", label: "予選A卓", status: "reporting", players: [], seats: [player, null, null, null] },
        { matchId: "b", label: "予選B卓", status: "reporting", players: [], seats: [null, null, null, null] },
      ] },
      { type: "final", label: "決勝", advanceCount: 1, matches: [
        { matchId: "c", label: "決勝A卓", status: "reporting", players: [], seats: [ticket, null, null, null] },
      ] },
    ],
  };
}
// 入力の破壊を例外として検出する。
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const entrants: MahjongCsEntrant[] = [
  { lineUserId: "p1", displayName: "一", tier: "M1", rank: 1, seed: false },
  { lineUserId: "p2", displayName: "二", tier: "M1", rank: 2, seed: false },
  { lineUserId: "p3", displayName: "三", tier: "M2", rank: 1, seed: false },
];

describe("CS bracket editing", () => {
  test("initialDraft uses a detached saved bracket or an empty preliminary round", () => {
    const saved = freeze(fixture());
    const result = initialDraft({ bracket: saved }, 3);
    expect(result).toEqual(saved);
    expect(result).not.toBe(saved);
    expect(result.rounds).not.toBe(saved.rounds);
    expect(initialDraft({}, 3)).toEqual({ seedUserIds: [], rounds: [
      { type: "prelim", label: "予選", advanceCount: 3, matches: [] },
    ] });
  });
  test("addRound makes only the last round final", () => {
    const result = addRound(freeze(fixture()), "追加", 3);
    expect(result.rounds.map((r) => r.type)).toEqual(["prelim", "prelim", "final"]);
    expect(result.rounds[2]).toEqual({ type: "final", label: "追加", advanceCount: 3, matches: [] });
  });
  test("removeRound clears dependent tickets and resets types", () => {
    const draft = freeze(fixture());
    expect(removeRound(draft, 0).rounds[0].matches[0].seats).toEqual([null, null, null, null]);
    expect(removeRound(draft, 1).rounds[0].type).toBe("final");
    expect(removeRound(draft, -1)).toBe(draft);
  });
  test("renameRound relabels tables in position order", () => {
    const result = renameRound(freeze(fixture()), 0, "準決勝");
    expect(result.rounds[0].label).toBe("準決勝");
    expect(result.rounds[0].matches.map((m) => m.label)).toEqual(["準決勝A卓", "準決勝B卓"]);
  });
  test("setAdvanceCount clears only tickets above the new limit", () => {
    const draft = freeze(fixture());
    expect(setAdvanceCount(draft, 0, 1).rounds[1].matches[0].seats![0]).toBeNull();
    expect(setAdvanceCount(draft, 0, 3).rounds[1].matches[0].seats![0]).toEqual(ticket);
    for (const n of [0, 4, 1.5, NaN]) expect(setAdvanceCount(draft, 0, n)).toBe(draft);
  });
  test("addTable supplies four empty seats and rejects duplicate ids across rounds", () => {
    const draft = freeze(fixture());
    expect(addTable(draft, 0, "d").rounds[0].matches[2]).toEqual({
      matchId: "d", label: "予選C卓", players: [], status: "reporting", seats: [null, null, null, null],
    });
    expect(addTable(draft, 0, "c")).toBe(draft);
  });
  test("removeTable relabels survivors and clears dependent tickets", () => {
    const result = removeTable(freeze(fixture()), 0, "a");
    expect(result.rounds[0].matches[0].label).toBe("予選A卓");
    expect(result.rounds[1].matches[0].seats![0]).toBeNull();
  });
  test("placeChip vacates its old seat and replaces the target occupant", () => {
    const result = placeChip(freeze(fixture()), player, "c", 0);
    expect(result.rounds[0].matches[0].seats![0]).toBeNull();
    expect(result.rounds[1].matches[0].seats![0]).toEqual(player);
  });
  test("placeChip accepts tickets only in the next round and within advance count", () => {
    const draft = freeze(fixture());
    expect(placeChip(draft, ticket, "a", 1)).toBe(draft);
    expect(placeChip(draft, { ...ticket, place: 3 }, "c", 1)).toBe(draft);
    expect(placeChip(draft, { ...ticket, fromMatchId: "missing" }, "c", 1)).toBe(draft);
    const result = placeChip(draft, ticket, "c", 2);
    expect(result.rounds[1].matches[0].seats).toEqual([null, null, ticket, null]);
  });
  test("clearSeat clears a valid seat and rejects invalid targets", () => {
    const draft = freeze(fixture());
    expect(clearSeat(draft, "a", 0).rounds[0].matches[0].seats![0]).toBeNull();
    for (const index of [-1, 4, 1.5]) {
      expect(clearSeat(draft, "a", index)).toBe(draft);
      expect(placeChip(draft, player, "a", index)).toBe(draft);
    }
    expect(clearSeat(draft, "missing", 0)).toBe(draft);
  });
  test("availableTickets omits already placed tickets and preserves source order", () => {
    const draft = freeze(fixture());
    expect(availableTickets(draft, 0)).toEqual([]);
    expect(availableTickets(draft, 1)).toEqual([
      { kind: "ticket", fromMatchId: "a", place: 1 },
      { kind: "ticket", fromMatchId: "b", place: 1 },
      { kind: "ticket", fromMatchId: "b", place: 2 },
    ]);
    expect(availableTickets(draft, 99)).toEqual([]);
  });
  test("toggleSeed adds at the end and removes without changing seat placement", () => {
    const draft = freeze(fixture());
    expect(toggleSeed(draft, "p1").seedUserIds).toEqual(["seed", "p1"]);
    expect(toggleSeed(draft, "seed").seedUserIds).toEqual([]);
    expect(toggleSeed(draft, "p1").rounds).toEqual(draft.rounds);
  });
  test("setTierSeeds preserves order, deduplicates, and removes only the chosen tier", () => {
    const draft = freeze({ ...fixture(), seedUserIds: ["p2", "seed"] });
    expect(setTierSeeds(draft, entrants, "M1", true).seedUserIds).toEqual(["p2", "seed", "p1"]);
    expect(setTierSeeds(draft, entrants, "M1", false).seedUserIds).toEqual(["seed"]);
    expect(setTierSeeds(draft, entrants, "M2", true).seedUserIds).toEqual(["p2", "seed", "p3"]);
  });
  test("fillEmptySeats excludes seeds and anyone placed in any round", () => {
    const draft = fixture();
    draft.rounds[1].matches[0].seats![1] = { kind: "player", lineUserId: "later" };
    const result = fillEmptySeats(freeze(draft), ["seed", "p1", "later", "p2", "p2", "p3", "p4", "p5"]);
    expect(result.rounds[0].matches[0].seats).toEqual([
      player, { kind: "player", lineUserId: "p2" },
      { kind: "player", lineUserId: "p3" }, { kind: "player", lineUserId: "p4" },
    ]);
    expect(result.rounds[0].matches[1].seats![0]).toEqual({ kind: "player", lineUserId: "p5" });
    expect(result.rounds[1]).toEqual(draft.rounds[1]);
  });
  test("invalid round operations leave the input unchanged", () => {
    const draft = freeze(fixture());
    expect(addRound(draft, "追加", 0)).toBe(draft);
    expect(renameRound(draft, 9, "追加")).toBe(draft);
    expect(setAdvanceCount(draft, 9, 2)).toBe(draft);
    expect(addTable(draft, 9, "d")).toBe(draft);
    expect(removeTable(draft, 0, "missing")).toBe(draft);
    expect(placeChip(draft, player, "missing", 0)).toBe(draft);
  });
});
