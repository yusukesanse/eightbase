/**
 * 単体テスト: src/lib/dartsAssign.ts（クリケット編成検証）。
 * 要件 §2.4: 2人1組・奇数は1人チーム可・全参加者を被覆。
 */
import { validateCricketTeams } from "@/lib/dartsAssign";
import type { DartsTeam } from "@/types/darts";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

describe("validateCricketTeams", () => {
  test("4名を2人×2チーム＝OK", () => {
    const teams: DartsTeam[] = [
      { teamId: "t1", memberIds: ["p1", "p2"] },
      { teamId: "t2", memberIds: ["p3", "p4"] },
    ];
    expect(validateCricketTeams(ids(4), teams)).toEqual({ ok: true });
  });

  test("奇数5名は1人チーム混在でOK", () => {
    const teams: DartsTeam[] = [
      { teamId: "t1", memberIds: ["p1", "p2"] },
      { teamId: "t2", memberIds: ["p3", "p4"] },
      { teamId: "t3", memberIds: ["p5"] },
    ];
    expect(validateCricketTeams(ids(5), teams)).toEqual({ ok: true });
  });

  test("3人チームは不可", () => {
    const teams: DartsTeam[] = [{ teamId: "t1", memberIds: ["p1", "p2", "p3"] }, { teamId: "t2", memberIds: ["p4"] }];
    const r = validateCricketTeams(ids(4), teams);
    expect(r.ok).toBe(false);
  });

  test("全員を割り当てていない（過不足）と不可", () => {
    const teams: DartsTeam[] = [{ teamId: "t1", memberIds: ["p1", "p2"] }];
    const r = validateCricketTeams(ids(4), teams);
    expect(r.ok).toBe(false);
  });

  test("同じ人が複数チームに入ると不可", () => {
    const teams: DartsTeam[] = [
      { teamId: "t1", memberIds: ["p1", "p2"] },
      { teamId: "t2", memberIds: ["p2", "p3"] },
    ];
    const r = validateCricketTeams(ids(3), teams);
    expect(r.ok).toBe(false);
  });

  test("参加者以外が混入すると不可", () => {
    const teams: DartsTeam[] = [
      { teamId: "t1", memberIds: ["p1", "p2"] },
      { teamId: "t2", memberIds: ["p3", "x9"] },
    ];
    const r = validateCricketTeams(ids(4), teams);
    expect(r.ok).toBe(false);
  });

  test("teamId 重複は不可", () => {
    const teams: DartsTeam[] = [
      { teamId: "t1", memberIds: ["p1", "p2"] },
      { teamId: "t1", memberIds: ["p3", "p4"] },
    ];
    const r = validateCricketTeams(ids(4), teams);
    expect(r.ok).toBe(false);
  });
});
