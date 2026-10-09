import {
  isManualCs, rebalanceEntries, waitlistPosition, closeEntriesIfDue, entrantsFromEntries,
} from "@/lib/mahjongCsEntry";
import type { MahjongCsEntry, MahjongCsEvent } from "@/types";

const e = (id: string, min: number, tier: "M1" | "M2" | "M3" = "M3"): MahjongCsEntry => ({
  lineUserId: id, displayName: id, tier, rank: 100000,
  enteredAt: `2026-10-01T00:${String(min).padStart(2, "0")}:00.000Z`, state: "confirmed",
});
const states = (xs: MahjongCsEntry[]) => Object.fromEntries(xs.map((x) => [x.lineUserId, x.state]));

describe("isManualCs", () => {
  it("capacity があれば新方式", () => {
    expect(isManualCs({ capacity: 40 } as MahjongCsEvent)).toBe(true);
    expect(isManualCs({} as MahjongCsEvent)).toBe(false);
  });
});

describe("rebalanceEntries（受付中）", () => {
  const opts = { capacity: 4, priorityUserIds: ["p1", "p2"], phase: "entry" as const };

  it("M3枠は 定員 − 優先枠の人数。超えたらキャンセル待ち", () => {
    const r = rebalanceEntries([e("a", 1), e("b", 2), e("c", 3)], opts);
    expect(states(r)).toEqual({ a: "confirmed", b: "confirmed", c: "waitlisted" });
  });

  it("優先枠の人は定員が埋まっていても参加確定", () => {
    const r = rebalanceEntries([e("a", 1), e("b", 2), e("p1", 3, "M1"), e("p2", 4, "M2")], opts);
    expect(states(r)).toEqual({ a: "confirmed", b: "confirmed", p1: "confirmed", p2: "confirmed" });
  });

  it("受付中は、優先枠の人が未表明でも M3 は繰り上がらない", () => {
    const r = rebalanceEntries([e("a", 1), e("b", 2), e("c", 3)], opts);
    expect(r.find((x) => x.lineUserId === "c")!.state).toBe("waitlisted");
  });

  it("M3 の確定者が抜けたら、キャンセル待ちの1番目（enteredAt が早い順）が繰り上がる", () => {
    const r = rebalanceEntries([e("b", 2), e("d", 4), e("c", 3)], opts);
    expect(states(r)).toEqual({ b: "confirmed", c: "confirmed", d: "waitlisted" });
  });

  it("入力配列を変更しない・enteredAt 順に並べて返す", () => {
    const input = [e("b", 2), e("a", 1)];
    const r = rebalanceEntries(input, opts);
    expect(input.map((x) => x.lineUserId)).toEqual(["b", "a"]);
    expect(r.map((x) => x.lineUserId)).toEqual(["a", "b"]);
  });
});

describe("rebalanceEntries（締切後）", () => {
  it("表明しなかった優先枠の分だけ、キャンセル待ちから繰り上がる。定員は超えない", () => {
    const opts = { capacity: 4, priorityUserIds: ["p1", "p2"], phase: "closed" as const };
    const r = rebalanceEntries([e("a", 1), e("b", 2), e("p1", 3, "M1"), e("c", 4), e("d", 5)], opts);
    expect(states(r)).toEqual({ a: "confirmed", b: "confirmed", p1: "confirmed", c: "confirmed", d: "waitlisted" });
  });
});

describe("waitlistPosition", () => {
  it("キャンセル待ちの何番目か（1始まり）。確定・未表明は null", () => {
    const xs = rebalanceEntries([e("a", 1), e("b", 2), e("c", 3), e("d", 4)],
      { capacity: 3, priorityUserIds: ["p1"], phase: "entry" });
    expect(waitlistPosition(xs, "c")).toBe(1);
    expect(waitlistPosition(xs, "d")).toBe(2);
    expect(waitlistPosition(xs, "a")).toBeNull();
    expect(waitlistPosition(xs, "zz")).toBeNull();
  });
});

describe("closeEntriesIfDue", () => {
  const base = {
    status: "entry", capacity: 3, priorityUserIds: ["p1"],
    entryClosesAt: "2026-10-08T12:00:00+09:00",
    entries: [e("a", 1), e("b", 2), e("c", 3)],
  } as unknown as MahjongCsEvent;

  it("締切前は null（境界: 締切の1ms前）", () => {
    expect(closeEntriesIfDue(base, "2026-10-08T02:59:59.999Z")).toBeNull();
  });

  it("締切時刻ちょうどで締める。未表明の優先枠ぶん繰り上げ、参加確定者を entrants にする", () => {
    const r = closeEntriesIfDue(base, "2026-10-08T03:00:00.000Z")!;
    expect(r.status).toBe("closed");
    expect(r.closedAt).toBe("2026-10-08T03:00:00.000Z");
    expect(states(r.entries!)).toEqual({ a: "confirmed", b: "confirmed", c: "confirmed" });
    expect(r.entrants!.map((x) => x.lineUserId)).toEqual(["a", "b", "c"]);
    expect(r.entrants![0].seed).toBe(false);
  });

  it("entry 以外の状態では null", () => {
    expect(closeEntriesIfDue({ ...base, status: "closed" }, "2026-10-09T00:00:00Z")).toBeNull();
  });
});

describe("entrantsFromEntries", () => {
  it("参加確定だけを、表明順で MahjongCsEntrant にする", () => {
    const xs = [e("a", 1, "M1"), { ...e("b", 2), state: "waitlisted" as const }];
    expect(entrantsFromEntries(xs)).toEqual([
      { lineUserId: "a", displayName: "a", tier: "M1", rank: 100000, seed: false },
    ]);
  });
});
