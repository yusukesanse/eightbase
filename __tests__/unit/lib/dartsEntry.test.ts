/**
 * 単体テスト: src/lib/dartsEntryStatus.ts / src/lib/dartsEntryValidation.ts
 * ※ TZ=UTC で実行（package.json）。曜日判定は UTC 正午基準。
 */
import { canTransition, deriveStatus } from "@/lib/dartsEntryStatus";
import {
  isValidDartsDate,
  isValidDocId,
  buildDartsEntryId,
  buildDartsScheduleId,
  isThursdayDate,
  generateBiweeklyThursdays,
} from "@/lib/dartsEntryValidation";

/* ───────── 状態機械 ───────── */
describe("dartsEntryStatus", () => {
  test("正しい遷移のみ許可", () => {
    expect(canTransition("reserved", "paid")).toBe(true);
    expect(canTransition("paid", "cancelRequested")).toBe(true);
    expect(canTransition("cancelRequested", "refunded")).toBe(true);
    expect(canTransition("cancelRequested", "cancelRejected")).toBe(true);
    expect(canTransition("cancelRejected", "cancelRequested")).toBe(true);
  });

  test("不正な遷移は拒否", () => {
    expect(canTransition("reserved", "cancelRequested")).toBe(false);
    expect(canTransition("paid", "refunded")).toBe(false);
    expect(canTransition("refunded", "paid")).toBe(false);
  });

  test("deriveStatus: status 優先・無ければ paymentStatus から後方互換導出", () => {
    expect(deriveStatus({ status: "paid" })).toBe("paid");
    expect(deriveStatus({ status: "refunded" })).toBe("refunded");
    expect(deriveStatus({ paymentStatus: "paid" })).toBe("paid");
    expect(deriveStatus({ paymentStatus: "cancelRequested" })).toBe("cancelRequested");
    expect(deriveStatus({})).toBe("reserved");
    expect(deriveStatus({ status: "bogus", paymentStatus: "paid" })).toBe("paid");
  });
});

/* ───────── バリデーション・ID ───────── */
describe("dartsEntryValidation ids", () => {
  test("日付/docId 形式", () => {
    expect(isValidDartsDate("2026-08-06")).toBe(true);
    expect(isValidDartsDate("2026/08/06")).toBe(false);
    expect(isValidDartsDate(20260806)).toBe(false);
    expect(isValidDocId("season_2026-08-06_U123")).toBe(true);
    expect(isValidDocId("bad/id")).toBe(false);
  });

  test("決定的ID", () => {
    expect(buildDartsEntryId("S", "2026-08-06", "U1")).toBe("S_2026-08-06_U1");
    expect(buildDartsScheduleId("S", "2026-08-06")).toBe("S_2026-08-06");
  });
});

/* ───────── 隔週木曜 ───────── */
describe("木曜・隔週生成", () => {
  test("木曜判定（UTC正午基準）", () => {
    expect(isThursdayDate("2026-08-06")).toBe(true); // 2026-08-06 は木曜
    expect(isThursdayDate("2026-08-07")).toBe(false); // 金曜
  });

  test("起点が木曜: 14日ごと", () => {
    const r = generateBiweeklyThursdays("2026-08-06", 4);
    expect(r).toEqual(["2026-08-06", "2026-08-20", "2026-09-03", "2026-09-17"]);
    expect(r.every(isThursdayDate)).toBe(true);
  });

  test("起点が木曜でない: 直後の木曜へ丸めてから隔週", () => {
    // 2026-08-03(月) → 直後の木曜 2026-08-06 から隔週
    const r = generateBiweeklyThursdays("2026-08-03", 3);
    expect(r).toEqual(["2026-08-06", "2026-08-20", "2026-09-03"]);
    expect(r.every(isThursdayDate)).toBe(true);
  });

  test("count=0 は空", () => {
    expect(generateBiweeklyThursdays("2026-08-06", 0)).toEqual([]);
  });
});
