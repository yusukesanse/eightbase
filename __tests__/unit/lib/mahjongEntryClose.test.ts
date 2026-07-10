/**
 * 単体テスト: 受付締切の判定（src/lib/mahjongDay.ts isEntryClosed）。
 *
 * 締切は GM の「ゲーム開始」だけで決まる（時刻による締切＝Season.mahjongStartTime は廃止）。
 */
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: () => ({}) }));

import { isEntryClosed } from "@/lib/mahjongDay";
import type { MahjongDayState } from "@/types";

const day = (over: Partial<MahjongDayState> = {}): MahjongDayState => ({
  seasonId: "s1",
  eventDate: "2026-07-11",
  round: 1,
  waiting: [],
  tableLabels: [],
  updatedAt: "2026-07-11T09:00:00.000Z",
  ...over,
});

describe("isEntryClosed", () => {
  test("当日がまだ始まっていない（dayState 無し）なら受付中", () => {
    expect(isEntryClosed(null)).toBe(false);
  });

  test("GM が開始していなければ受付中", () => {
    expect(isEntryClosed(day())).toBe(false);
    expect(isEntryClosed(day({ entryClosedAt: null }))).toBe(false);
  });

  test("GM が「ゲーム開始」を押していたら締切", () => {
    expect(isEntryClosed(day({ entryClosedAt: "2026-07-11T04:00:00.000Z" }))).toBe(true);
  });
});
