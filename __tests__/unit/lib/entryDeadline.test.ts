/**
 * 単体テスト（再発防止）: 参加受付の締切＝開催日の開始時刻（JST）。
 *
 * ⚠️ 本番は TZ=UTC で動く。`new Date("YYYY-MM-DDTHH:MM")`（オフセットなし）はサーバーのTZ解釈になり、
 * JSTのつもりが9時間ズレる。実際に「サウナが土曜だけ営業なのに本番で予約不能」という同型の事故があった。
 * ここでは **+09:00 を明示して組み立てていること**を境界値で固定する。
 * テストは package.json で TZ=UTC 固定（JSTで流すと壊れた実装でも通ってしまう）。
 */

import { isPastEntryDeadline } from "@/lib/entryDeadline";

const at = (iso: string) => new Date(iso);

describe("isPastEntryDeadline（JST基準の締切判定）", () => {
  const DATE = "2026-08-01";
  const START = "18:00"; // JST 18:00 = UTC 09:00

  test("開始時刻ちょうどは締切済み（以上で判定）", () => {
    expect(isPastEntryDeadline(DATE, START, at("2026-08-01T09:00:00.000Z"))).toBe(true);
  });

  test("開始1分前はまだ受付中", () => {
    expect(isPastEntryDeadline(DATE, START, at("2026-08-01T08:59:00.000Z"))).toBe(false);
  });

  test("開始1分後は締切済み", () => {
    expect(isPastEntryDeadline(DATE, START, at("2026-08-01T09:01:00.000Z"))).toBe(true);
  });

  test("UTCで同日でもJSTではまだ当日前なら受付中（TZ取り違えの検出）", () => {
    // UTC 2026-08-01 00:00 = JST 09:00 → 18:00 締切前
    expect(isPastEntryDeadline(DATE, START, at("2026-08-01T00:00:00.000Z"))).toBe(false);
  });

  test("JSTの日付が変わる直前（UTC前日15:00＝JST当日0:00）は受付中", () => {
    expect(isPastEntryDeadline(DATE, START, at("2026-07-31T15:00:00.000Z"))).toBe(false);
  });

  test("13:00開始でも境界がJSTでずれない", () => {
    // JST 13:00 = UTC 04:00
    expect(isPastEntryDeadline(DATE, "13:00", at("2026-08-01T03:59:59.000Z"))).toBe(false);
    expect(isPastEntryDeadline(DATE, "13:00", at("2026-08-01T04:00:00.000Z"))).toBe(true);
  });

  test("翌日になっていれば当然締切済み", () => {
    expect(isPastEntryDeadline(DATE, START, at("2026-08-02T00:00:00.000Z"))).toBe(true);
  });

  test("時刻が壊れているときは締めない（受付を止めて詰ませない）", () => {
    expect(isPastEntryDeadline(DATE, "ほげ", at("2026-12-31T00:00:00.000Z"))).toBe(false);
    expect(isPastEntryDeadline("bad-date", START, at("2026-12-31T00:00:00.000Z"))).toBe(false);
  });
});
