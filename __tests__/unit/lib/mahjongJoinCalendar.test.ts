/**
 * 単体テスト: src/lib/mahjongJoinCalendar.ts
 * 閲覧可(isViewableDate) / 参加可(canJoinDate) / 過去土曜(isPastSaturday) / 月1回(isMonthlyBlocked)。
 * TZ=UTC で実行（package.json）。日付は "YYYY-MM-DD"。
 */
import {
  isSaturdayDate,
  isPastSaturday,
  isMonthlyBlocked,
  isViewableDate,
  canJoinDate,
  isMahjongEventDay,
  isPastEventDate,
} from "@/lib/mahjongJoinCalendar";

// 2026-07 の土曜: 04, 11, 18, 25 / 平日例: 07-15(水)
const SAT_PAST = "2026-07-04";
const SAT_TODAY = "2026-07-11";
const SAT_FUTURE = "2026-07-18";
const WEEKDAY = "2026-07-15";
const TODAY = "2026-07-11";

const empty = () => new Set<string>();
const baseCtx = () => ({
  today: TODAY,
  enteredDates: empty(),
  closedDates: empty(),
  cancelledDates: empty(),
});

// スケジュール駆動（管理者が任意日を登録）: 日曜開催などを想定。
const SUN_FUTURE = "2026-07-19"; // 日曜
const SUN_PAST = "2026-07-05"; // 過去の日曜

describe("スケジュール駆動（scheduledDates 非空・曜日不問）", () => {
  const schedCtx = (extra: Partial<ReturnType<typeof baseCtx>> = {}) => ({
    ...baseCtx(),
    scheduledDates: new Set([SUN_FUTURE, SUN_PAST, "2026-07-25"]),
    ...extra,
  });

  test("isMahjongEventDay: スケジュールにある日のみ（日曜も可）", () => {
    expect(isMahjongEventDay(SUN_FUTURE, schedCtx())).toBe(true);
    expect(isMahjongEventDay(SAT_FUTURE, schedCtx())).toBe(false); // 土曜でも schedule 外は不可
  });
  test("isViewableDate/canJoinDate が日曜開催を許可", () => {
    expect(isViewableDate(SUN_FUTURE, schedCtx())).toBe(true);
    expect(canJoinDate(SUN_FUTURE, { ...schedCtx(), full: false })).toBe(true);
    // schedule 外の土曜は不可
    expect(isViewableDate(SAT_FUTURE, schedCtx())).toBe(false);
    expect(canJoinDate(SAT_FUTURE, { ...schedCtx(), full: false })).toBe(false);
  });
  test("中止(cancelled)は不可・過去日は参加不可(閲覧のみ)", () => {
    expect(canJoinDate(SUN_FUTURE, { ...schedCtx({ cancelledDates: new Set([SUN_FUTURE]) }), full: false })).toBe(false);
    expect(isViewableDate(SUN_PAST, schedCtx())).toBe(true); // 過去でも閲覧可
    expect(canJoinDate(SUN_PAST, { ...schedCtx(), full: false })).toBe(false); // 過去は参加不可
  });
  test("isPastEventDate: 過去の日曜開催も true", () => {
    expect(isPastEventDate(SUN_PAST, schedCtx())).toBe(true);
    expect(isPastEventDate(SUN_FUTURE, schedCtx())).toBe(false);
  });
});

describe("未移行フォールバック（scheduledDates 空）＝従来の土曜", () => {
  test("土曜のみ開催日・isPastEventDate は過去土曜のみ", () => {
    expect(isMahjongEventDay(SAT_FUTURE, baseCtx())).toBe(true);
    expect(isMahjongEventDay(SUN_FUTURE, baseCtx())).toBe(false);
    expect(isPastEventDate(SAT_PAST, baseCtx())).toBe(true);
    expect(isPastEventDate(SUN_PAST, baseCtx())).toBe(false);
  });
});

describe("isSaturdayDate / isPastSaturday", () => {
  test("土曜判定（UTC正午基準）", () => {
    expect(isSaturdayDate(SAT_FUTURE)).toBe(true);
    expect(isSaturdayDate(WEEKDAY)).toBe(false);
  });
  test("過去の土曜のみ true（当日・未来・平日は false）", () => {
    expect(isPastSaturday(SAT_PAST, TODAY)).toBe(true);
    expect(isPastSaturday(SAT_TODAY, TODAY)).toBe(false); // 当日は過去ではない
    expect(isPastSaturday(SAT_FUTURE, TODAY)).toBe(false);
    expect(isPastSaturday(WEEKDAY, TODAY)).toBe(false);
  });
});

describe("isMonthlyBlocked — 当月別日参加済み", () => {
  test("同月に別日参加があれば true（自分自身の日は除外）", () => {
    const entered = new Set([SAT_PAST]); // 7月に参加済み
    expect(isMonthlyBlocked(SAT_FUTURE, entered)).toBe(true); // 別の7月土曜
    expect(isMonthlyBlocked(SAT_PAST, entered)).toBe(false); // 自身は除外
    expect(isMonthlyBlocked("2026-08-01", entered)).toBe(false); // 別月
  });
});

describe("isViewableDate — カレンダーでタップ可", () => {
  test("未来の土曜は閲覧可", () => {
    expect(isViewableDate(SAT_FUTURE, baseCtx())).toBe(true);
  });
  test("過去の土曜も閲覧可（成績確認用）", () => {
    expect(isViewableDate(SAT_PAST, baseCtx())).toBe(true);
  });
  test("平日は不可", () => {
    expect(isViewableDate(WEEKDAY, baseCtx())).toBe(false);
  });
  test("休催・中止は不可", () => {
    expect(isViewableDate(SAT_FUTURE, { ...baseCtx(), closedDates: new Set([SAT_FUTURE]) })).toBe(false);
    expect(isViewableDate(SAT_FUTURE, { ...baseCtx(), cancelledDates: new Set([SAT_FUTURE]) })).toBe(false);
  });
  test("参加日は曜日/過去に関わらず常に閲覧可（休催でも）", () => {
    const ctx = { ...baseCtx(), enteredDates: new Set([WEEKDAY]), closedDates: new Set([WEEKDAY]) };
    expect(isViewableDate(WEEKDAY, ctx)).toBe(true);
  });
});

describe("canJoinDate — 参加ボタン可否", () => {
  test("未来の土曜・未参加・非満員・月制限なしなら可", () => {
    expect(canJoinDate(SAT_FUTURE, { ...baseCtx(), full: false })).toBe(true);
  });
  test("当日の土曜も参加可（過去ではない）", () => {
    expect(canJoinDate(SAT_TODAY, { ...baseCtx(), full: false })).toBe(true);
  });
  test("過去の土曜は参加不可（閲覧専用）", () => {
    expect(canJoinDate(SAT_PAST, { ...baseCtx(), full: false })).toBe(false);
  });
  test("満員は不可", () => {
    expect(canJoinDate(SAT_FUTURE, { ...baseCtx(), full: true })).toBe(false);
  });
  test("当月別日参加済みは不可", () => {
    expect(
      canJoinDate(SAT_FUTURE, { ...baseCtx(), enteredDates: new Set([SAT_TODAY]), full: false })
    ).toBe(false);
  });
  test("既に参加済みの日は不可（参加ボタンは出さない）", () => {
    expect(
      canJoinDate(SAT_FUTURE, { ...baseCtx(), enteredDates: new Set([SAT_FUTURE]), full: false })
    ).toBe(false);
  });
  test("休催・中止は不可", () => {
    expect(canJoinDate(SAT_FUTURE, { ...baseCtx(), full: false, closedDates: new Set([SAT_FUTURE]) })).toBe(false);
    expect(canJoinDate(SAT_FUTURE, { ...baseCtx(), full: false, cancelledDates: new Set([SAT_FUTURE]) })).toBe(false);
  });
});
