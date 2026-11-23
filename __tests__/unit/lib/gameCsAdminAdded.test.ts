/** adminAdded（管理者が追加した印）は表示用。並べ直しでは特別扱いせず、定員に数える。 */
import { rebalanceEntries } from "@/lib/mahjongCsEntry";
import type { MahjongCsEntry } from "@/types";

const e = (id: string, minute: number, extra: Partial<MahjongCsEntry> = {}): MahjongCsEntry => ({
  lineUserId: id, displayName: id, tier: "M3", rank: 100000,
  enteredAt: `2099-11-01T00:${String(minute).padStart(2, "0")}:00Z`, state: "confirmed", ...extra,
});

test.each([["entry"], ["closed"]] as const)("adminAdded があっても結果は変わらない（%s）", (phase) => {
  const plain = [e("p1", 0), e("a", 1), e("b", 2), e("x", 3), e("c", 4)];
  const flagged = plain.map((x) => (x.lineUserId === "x" || x.lineUserId === "p1" ? { ...x, adminAdded: true } : x));
  const opts = { capacity: 3, priorityUserIds: ["p1", "p2"], phase };
  const strip = (list: MahjongCsEntry[]) => list.map(({ adminAdded: _flag, ...rest }) => rest);
  expect(strip(rebalanceEntries(flagged, opts))).toEqual(rebalanceEntries(plain, opts));
});

test("定員を超えた adminAdded の人はキャンセル待ちになる（定員に数える）", () => {
  const out = rebalanceEntries([e("a", 1), e("x", 2, { adminAdded: true })], { capacity: 1, priorityUserIds: [], phase: "entry" });
  expect(out.map((x) => x.state)).toEqual(["confirmed", "waitlisted"]);
});
