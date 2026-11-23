/** 管理者が追加した人（adminAdded）は定員に数えず、常に参加確定になる。 */
import { rebalanceEntries } from "@/lib/mahjongCsEntry";
import type { MahjongCsEntry } from "@/types";

const e = (id: string, minute: number, extra: Partial<MahjongCsEntry> = {}): MahjongCsEntry => ({
  lineUserId: id, displayName: id, tier: "M3", rank: 100000,
  enteredAt: `2099-11-01T00:${String(minute).padStart(2, "0")}:00Z`, state: "confirmed", ...extra,
});
const states = (entries: MahjongCsEntry[]) => Object.fromEntries(entries.map((x) => [x.lineUserId, x.state]));

test("定員いっぱいで adminAdded を足しても、既存の確定者はキャンセル待ちに落ちない", () => {
  const out = rebalanceEntries([e("a", 1), e("b", 2), e("x", 0, { adminAdded: true })],
    { capacity: 2, priorityUserIds: [], phase: "entry" });
  expect(states(out)).toEqual({ x: "confirmed", a: "confirmed", b: "confirmed" });
});

test("adminAdded のキャンセル待ちは確定になり、ほかのキャンセル待ちはそのまま", () => {
  const out = rebalanceEntries(
    [e("a", 1), e("b", 2, { state: "waitlisted" }), e("c", 3, { state: "waitlisted", adminAdded: true })],
    { capacity: 1, priorityUserIds: [], phase: "closed" });
  expect(states(out)).toEqual({ a: "confirmed", b: "waitlisted", c: "confirmed" });
});

test("確定済みの一般枠の人に adminAdded が立つと、その席が空いてキャンセル待ちの先頭が繰り上がる", () => {
  const out = rebalanceEntries([e("a", 1, { adminAdded: true }), e("b", 2, { state: "waitlisted" })],
    { capacity: 1, priorityUserIds: [], phase: "entry" });
  expect(states(out)).toEqual({ a: "confirmed", b: "confirmed" });
});

test("adminAdded の優先枠の人は席を二重に取らない（受付中）", () => {
  // 定員3・優先枠 p1,p2。p1 は管理者追加なので、優先枠の予約席は p2 の1つだけ → 一般枠は2
  const out = rebalanceEntries([e("p1", 0, { adminAdded: true }), e("a", 1), e("b", 2), e("c", 3)],
    { capacity: 3, priorityUserIds: ["p1", "p2"], phase: "entry" });
  expect(states(out)).toEqual({ p1: "confirmed", a: "confirmed", b: "confirmed", c: "waitlisted" });
});

test("adminAdded の優先枠の人は席を二重に取らない（締切後）", () => {
  const out = rebalanceEntries([e("p1", 0, { adminAdded: true }), e("p2", 1), e("a", 2), e("b", 3), e("c", 4)],
    { capacity: 3, priorityUserIds: ["p1", "p2"], phase: "closed" });
  expect(states(out)).toEqual({ p1: "confirmed", p2: "confirmed", a: "confirmed", b: "confirmed", c: "waitlisted" });
});

test("adminAdded がいなければ従来と同じ結果で、adminAdded のキーも足さない", () => {
  const input = [e("p1", 5), e("a", 1), e("b", 2), e("c", 3)];
  for (const phase of ["entry", "closed"] as const) {
    const out = rebalanceEntries(input, { capacity: 3, priorityUserIds: ["p1", "p2"], phase });
    expect(out).toEqual([
      { ...input[1], state: "confirmed" },
      { ...input[2], state: phase === "closed" ? "confirmed" : "waitlisted" },
      { ...input[3], state: "waitlisted" },
      { ...input[0], state: "confirmed" },
    ]);
    expect(out.every((x) => !("adminAdded" in x))).toBe(true);
  }
});
