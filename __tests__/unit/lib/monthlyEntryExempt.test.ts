/**
 * 単体テスト: 月1回のゲーム参加制限の免除（管理者が特定ユーザーだけ解除する）
 *
 * 固定する仕様:
 *  - `authorizedUsers.monthlyEntryExempt === true` のときだけ免除（未設定・"true" 文字列・1 は免除しない）
 *  - requireGameUserWithRole が同じ authorizedUsers から免除フラグを返す（追加の読み取りをしない）
 *  - クライアントのカレンダー判定（isMonthlyBlocked / canJoinDate）も免除で開く
 *    ※ 表示の出し分けだけ。可否の最終判定は POST /api/{game}/entries（別テスト）。
 */
import type { NextRequest } from "next/server";

let mockSessionUserId: string | null = null;
let mockUserDoc: Record<string, unknown> | null = null;

jest.mock("@/lib/session", () => ({ getSessionUserId: async () => mockSessionUserId }));
jest.mock("@/lib/preview", () => ({ isPreviewMode: async () => false, PREVIEW_USER_ID: "preview-user" }));
jest.mock("@/lib/env", () => ({ isDevLoginEnabled: () => false }));
jest.mock("@/lib/firebaseAdmin", () => ({
  getDb: () => ({
    collection: () => ({
      where: () => ({
        where: () => ({
          limit: () => ({
            get: async () => ({
              empty: mockUserDoc === null,
              docs: mockUserDoc === null ? [] : [{ data: () => mockUserDoc }],
            }),
          }),
        }),
      }),
    }),
  }),
}));

import { isMonthlyEntryExempt, MONTHLY_ENTRY_EXEMPT_FIELD } from "@/lib/monthlyEntryExempt";
import { requireGameUserWithRole } from "@/lib/auth";
import { isMonthlyBlocked, canJoinDate } from "@/lib/mahjongJoinCalendar";

const req = { method: "GET" } as unknown as NextRequest;

beforeEach(() => {
  mockSessionUserId = "U_user";
  mockUserDoc = null;
});

describe("isMonthlyEntryExempt", () => {
  test("true のときだけ免除", () => {
    expect(isMonthlyEntryExempt({ monthlyEntryExempt: true })).toBe(true);
  });

  test("未設定・false・null は免除しない（既存レコードは従来どおり月1回）", () => {
    expect(isMonthlyEntryExempt({})).toBe(false);
    expect(isMonthlyEntryExempt({ monthlyEntryExempt: false })).toBe(false);
    expect(isMonthlyEntryExempt(null)).toBe(false);
    expect(isMonthlyEntryExempt(undefined)).toBe(false);
  });

  test("truthy な別の型（\"true\" / 1）では免除しない", () => {
    expect(isMonthlyEntryExempt({ monthlyEntryExempt: "true" })).toBe(false);
    expect(isMonthlyEntryExempt({ monthlyEntryExempt: 1 })).toBe(false);
  });

  test("フィールド名は管理APIと共有する定数", () => {
    expect(MONTHLY_ENTRY_EXEMPT_FIELD).toBe("monthlyEntryExempt");
  });
});

describe("requireGameUserWithRole — 免除フラグを返す", () => {
  test("免除ユーザー", async () => {
    mockUserDoc = { role: "member", active: true, monthlyEntryExempt: true };
    expect(await requireGameUserWithRole(req)).toEqual({
      lineUserId: "U_user",
      role: "member",
      monthlyEntryExempt: true,
    });
  });

  test("未設定の既存ユーザーは false", async () => {
    mockUserDoc = { role: "guest", active: true };
    expect((await requireGameUserWithRole(req))?.monthlyEntryExempt).toBe(false);
  });

  test("未登録(active外)は従来どおり null", async () => {
    mockUserDoc = null;
    expect(await requireGameUserWithRole(req)).toBeNull();
  });
});

describe("参加カレンダー（麻雀）— 免除で同月の別日が開く", () => {
  const TODAY = "2026-07-11";
  const SAT_A = "2026-07-11";
  const SAT_B = "2026-07-18";
  const ctx = (monthlyExempt: boolean) => ({
    today: TODAY,
    enteredDates: new Set([SAT_A]),
    closedDates: new Set<string>(),
    cancelledDates: new Set<string>(),
    monthlyExempt,
  });

  test("免除なし: 同月の別日はブロック", () => {
    expect(isMonthlyBlocked(SAT_B, new Set([SAT_A]))).toBe(true);
    expect(canJoinDate(SAT_B, { ...ctx(false), full: false })).toBe(false);
  });

  test("免除あり: 同月の別日も参加可", () => {
    expect(isMonthlyBlocked(SAT_B, new Set([SAT_A]), true)).toBe(false);
    expect(canJoinDate(SAT_B, { ...ctx(true), full: false })).toBe(true);
  });

  test("免除しても定員・中止・過去日は開かない（月1回だけの免除）", () => {
    expect(canJoinDate(SAT_B, { ...ctx(true), full: true })).toBe(false);
    expect(canJoinDate(SAT_B, { ...ctx(true), cancelledDates: new Set([SAT_B]), full: false })).toBe(false);
    expect(canJoinDate("2026-07-04", { ...ctx(true), full: false })).toBe(false); // 過去土曜
  });
});
