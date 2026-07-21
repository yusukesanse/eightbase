/**
 * 単体テスト（再発防止）: ダーツの入力検証。
 * - Issue 7: isValidDartsDate は実在日付のみ許可（2026-99-99 / 2026-02-31 を弾く・UTC基準）
 * - Issue 6: プロトタイプ汚染・危険な teamId を弾く
 */
import {
  isValidDartsDate,
  isDangerousObjectKey,
  isSafeTeamId,
  isThursdayDate,
  generateBiweeklyThursdays,
} from "@/lib/dartsEntryValidation";
import { validateCricketTeams } from "@/lib/dartsAssign";

describe("isValidDartsDate（Issue 7・実在日付）", () => {
  test("正しい日付は許可", () => {
    expect(isValidDartsDate("2026-07-16")).toBe(true);
    expect(isValidDartsDate("2026-02-28")).toBe(true);
    expect(isValidDartsDate("2028-02-29")).toBe(true); // 閏年
  });
  test("形式不正を弾く", () => {
    expect(isValidDartsDate("2026/07/16")).toBe(false);
    expect(isValidDartsDate("2026-7-16")).toBe(false);
    expect(isValidDartsDate("")).toBe(false);
    expect(isValidDartsDate(20260716)).toBe(false);
    expect(isValidDartsDate(null)).toBe(false);
  });
  test("実在しない日付を弾く（正規表現だけでは通っていたもの）", () => {
    expect(isValidDartsDate("2026-99-99")).toBe(false);
    expect(isValidDartsDate("2026-02-31")).toBe(false);
    expect(isValidDartsDate("2026-00-10")).toBe(false);
    expect(isValidDartsDate("2026-13-01")).toBe(false);
    expect(isValidDartsDate("2027-02-29")).toBe(false); // 平年に2/29なし
  });
  test("既存の曜日判定・隔週生成を壊さない", () => {
    expect(isThursdayDate("2026-07-16")).toBe(true); // 木曜
    const dates = generateBiweeklyThursdays("2026-07-16", 3);
    expect(dates).toEqual(["2026-07-16", "2026-07-30", "2026-08-13"]);
    for (const d of dates) expect(isValidDartsDate(d)).toBe(true);
  });
});

describe("危険キー / teamId（Issue 6）", () => {
  test("isDangerousObjectKey", () => {
    expect(isDangerousObjectKey("__proto__")).toBe(true);
    expect(isDangerousObjectKey("prototype")).toBe(true);
    expect(isDangerousObjectKey("constructor")).toBe(true);
    expect(isDangerousObjectKey("t1")).toBe(false);
  });
  test("isSafeTeamId", () => {
    expect(isSafeTeamId("t0")).toBe(true);
    expect(isSafeTeamId("demo-t1")).toBe(true);
    expect(isSafeTeamId("__proto__")).toBe(false);
    expect(isSafeTeamId("constructor")).toBe(false);
    expect(isSafeTeamId("a.b")).toBe(false); // Firestore フィールド名に危険
    expect(isSafeTeamId("a/b")).toBe(false);
    expect(isSafeTeamId("")).toBe(false);
    expect(isSafeTeamId(123 as unknown)).toBe(false);
  });
  test("validateCricketTeams は危険な teamId を拒否", () => {
    expect(validateCricketTeams(["a", "b"], [{ teamId: "__proto__", memberIds: ["a", "b"] }]).ok).toBe(false);
    expect(validateCricketTeams(["a", "b"], [{ teamId: "t1.x", memberIds: ["a", "b"] }]).ok).toBe(false);
    // 正常な編成は通る
    expect(validateCricketTeams(["a", "b"], [{ teamId: "t1", memberIds: ["a", "b"] }]).ok).toBe(true);
  });
});
