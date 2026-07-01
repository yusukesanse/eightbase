/**
 * 単体テスト: src/lib/mahjong.ts toPublicMahjongTable
 * ゲスト開放APIの応答から LINE 内部ID を露出させないことを検証する。
 */
import type { MahjongTable } from "@/types";

// mahjong.ts は firebaseAdmin を import するため、DB を無害化しておく（本関数は純粋関数）。
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: () => ({}) }));

import { toPublicMahjongTable } from "@/lib/mahjong";

const ME = "U_me";
const OTHER = "U_other";

function sampleTable(): MahjongTable {
  return {
    tableId: "t1",
    seasonId: "s1",
    eventDate: "2026-07-01",
    createdBy: "system",
    memberIds: [ME, OTHER, "U_a", "U_b"],
    members: [
      { lineUserId: ME, displayName: "自分", pictureUrl: "p0", points: 30000, rank: 1, reportedAt: "2026-07-01T09:00:00.000Z" },
      { lineUserId: OTHER, displayName: "相手", pictureUrl: "p1", points: 25000, rank: 2, reportedAt: null },
      { lineUserId: "U_a", displayName: "A", points: null, rank: null, reportedAt: null },
      { lineUserId: "U_b", displayName: "B", points: null, rank: null, reportedAt: null },
    ],
    status: "reporting",
    round: 1,
    tableLabel: "A",
    createdAt: "2026-07-01T08:00:00.000Z",
    updatedAt: "2026-07-01T08:00:00.000Z",
  };
}

describe("toPublicMahjongTable — 内部ID露出防止", () => {
  test("memberIds / createdBy を含めない", () => {
    const pub = toPublicMahjongTable(sampleTable(), ME);
    expect(pub).not.toHaveProperty("memberIds");
    expect(pub).not.toHaveProperty("createdBy");
  });

  test("members に lineUserId を含めない", () => {
    const pub = toPublicMahjongTable(sampleTable(), ME);
    for (const m of pub.members) {
      expect(m).not.toHaveProperty("lineUserId");
    }
    // JSON にも一切現れないこと（ネスト漏れ検知）
    expect(JSON.stringify(pub)).not.toContain(ME);
    expect(JSON.stringify(pub)).not.toContain(OTHER);
  });

  test("表示に必要なフィールドは保持する", () => {
    const pub = toPublicMahjongTable(sampleTable(), ME);
    expect(pub.members[0]).toEqual({
      displayName: "自分",
      pictureUrl: "p0",
      points: 30000,
      rank: 1,
      reportedAt: "2026-07-01T09:00:00.000Z",
      isCurrentUser: true,
    });
  });

  test("isCurrentUser はリクエスト元だけ true", () => {
    const pub = toPublicMahjongTable(sampleTable(), ME);
    expect(pub.members.map((m) => m.isCurrentUser)).toEqual([true, false, false, false]);
  });

  test("mine はメンバーに含まれる時 true / 含まれない時 false", () => {
    expect(toPublicMahjongTable(sampleTable(), ME).mine).toBe(true);
    expect(toPublicMahjongTable(sampleTable(), "U_stranger").mine).toBe(false);
  });

  test("非メンバー視点では自席強調が付かない（全員 isCurrentUser=false）", () => {
    const pub = toPublicMahjongTable(sampleTable(), "U_stranger");
    expect(pub.members.every((m) => m.isCurrentUser === false)).toBe(true);
  });

  test("卓のメタ情報（round/tableLabel/status等）は保持する", () => {
    const pub = toPublicMahjongTable(sampleTable(), ME);
    expect(pub.tableId).toBe("t1");
    expect(pub.round).toBe(1);
    expect(pub.tableLabel).toBe("A");
    expect(pub.status).toBe("reporting");
    expect(pub.eventDate).toBe("2026-07-01");
  });
});
