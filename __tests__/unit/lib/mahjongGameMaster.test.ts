/**
 * 単体テスト: GM シーズン判定（src/lib/mahjong.ts）。
 */
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: () => ({}) }));

import { isManualAssignmentSeason, isGameMaster } from "@/lib/mahjong";

describe("isManualAssignmentSeason / isGameMaster", () => {
  test("gameMasterIds 空 or 未設定 → 自動進行シーズン(false)", () => {
    expect(isManualAssignmentSeason(null)).toBe(false);
    expect(isManualAssignmentSeason(undefined)).toBe(false);
    expect(isManualAssignmentSeason({})).toBe(false);
    expect(isManualAssignmentSeason({ gameMasterIds: [] })).toBe(false);
  });

  test("gameMasterIds 1件以上 → 手動シーズン(true)", () => {
    expect(isManualAssignmentSeason({ gameMasterIds: ["u1"] })).toBe(true);
    expect(isManualAssignmentSeason({ gameMasterIds: ["u1", "u2"] })).toBe(true);
  });

  test("isGameMaster: 含まれるユーザーのみ true", () => {
    const s = { gameMasterIds: ["u1", "u2"] };
    expect(isGameMaster(s, "u1")).toBe(true);
    expect(isGameMaster(s, "u2")).toBe(true);
    expect(isGameMaster(s, "u3")).toBe(false);
    expect(isGameMaster(null, "u1")).toBe(false);
    expect(isGameMaster({}, "u1")).toBe(false);
    expect(isGameMaster({ gameMasterIds: [] }, "u1")).toBe(false);
  });
});
