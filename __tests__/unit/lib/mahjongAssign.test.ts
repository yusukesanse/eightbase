/**
 * 単体テスト: GM 手動卓振り分けの検証（src/lib/mahjongAssign.ts）。
 */
import { validateGmAssignment, isAssignmentLocked } from "@/lib/mahjongAssign";

const pool = (n: number) => Array.from({ length: n }, (_, i) => `u${i + 1}`);
const A = (ids: string[]) => ({ label: "A", memberIds: ids });
const B = (ids: string[]) => ({ label: "B", memberIds: ids });

describe("validateGmAssignment", () => {
  test("8名 → A4+B4・待機0で ok", () => {
    const p = pool(8);
    expect(validateGmAssignment(p, [A(p.slice(0, 4)), B(p.slice(4, 8))], [])).toEqual({ ok: true });
  });

  test("9名 → A4+B4+待機1で ok", () => {
    const p = pool(9);
    expect(validateGmAssignment(p, [A(p.slice(0, 4)), B(p.slice(4, 8))], [p[8]])).toEqual({ ok: true });
  });

  test("5名 → A4+待機1で ok（B卓なし）", () => {
    const p = pool(5);
    expect(validateGmAssignment(p, [A(p.slice(0, 4))], [p[4]])).toEqual({ ok: true });
  });

  test("1卓5名 → NG（4名上限）", () => {
    const p = pool(5);
    expect(validateGmAssignment(p, [A(p)], []).ok).toBe(false);
  });

  test("重複配置 → NG", () => {
    const p = pool(8);
    const r = validateGmAssignment(p, [A([p[0], p[0], p[1], p[2]]), B(p.slice(3, 7))], []);
    expect(r.ok).toBe(false);
  });

  test("未配置あり（過不足）→ NG", () => {
    const p = pool(8);
    // B卓の4名が未配置
    expect(validateGmAssignment(p, [A(p.slice(0, 4))], []).ok).toBe(false);
  });

  test("paid外のIDが含まれる → NG", () => {
    const p = pool(4);
    const r = validateGmAssignment(p, [A([p[0], p[1], p[2], "x-not-paid"])], []);
    expect(r.ok).toBe(false);
  });

  test("ラベル不正（C卓）→ NG", () => {
    const p = pool(4);
    expect(validateGmAssignment(p, [{ label: "C", memberIds: p }], []).ok).toBe(false);
  });

  test("ラベル重複（A卓2つ）→ NG", () => {
    const p = pool(8);
    const r = validateGmAssignment(p, [A(p.slice(0, 4)), A(p.slice(4, 8))], []);
    expect(r.ok).toBe(false);
  });
});

describe("isAssignmentLocked（GET /assignment と POST /assign が共有）", () => {
  const reported = [{ members: [{ rank: 1, reportedAt: "2026-07-11T10:00:00Z" }] }];
  const fresh = [{ members: [{ rank: null, reportedAt: null }] }];

  test("確定済み(awaiting=false)で申告が入っていたらロック", () => {
    expect(isAssignmentLocked(false, reported)).toBe(true);
  });

  test("確定済みでも申告前ならロックしない（申告前は編集できる）", () => {
    expect(isAssignmentLocked(false, fresh)).toBe(false);
  });

  test("振り分け待ち(awaiting=true)なら、残骸の卓に申告があってもロックしない", () => {
    // 自動進行シーズンから GM シーズンへ切り替えた際、先の round の卓が残っていても
    // GM が振り分けられなくならないこと（実障害の再発防止）。
    expect(isAssignmentLocked(true, reported)).toBe(false);
  });

  test("卓が無ければロックしない", () => {
    expect(isAssignmentLocked(false, [])).toBe(false);
    expect(isAssignmentLocked(true, [])).toBe(false);
  });
});
