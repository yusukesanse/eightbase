/**
 * 単体テスト: src/lib/eventListing.ts
 * イベント一覧の「今後 / 過去 / すべて」の絞り込みと並び順（/events と /info で共用）。
 * TZ=UTC で実行（package.json）。「今日」は JST の YYYY-MM-DD を明示して渡す。
 *
 * 背景（2026-09-07）: LINE の「イベントを見る」から開く /events が API の昇順をそのまま
 * 先頭＝Featured にしていたため、過去のイベントが最上段に出ていた。
 */
import { filterAndSortEvents } from "@/lib/eventListing";
import { jstDateFromIso } from "@/lib/date";

type Ev = { eventId: string; startAt: string };
const ev = (eventId: string, startAt: string): Ev => ({ eventId, startAt });

// 2026-09-08（火）を「今日」とする。ISO はすべて JST(+09:00) で書く。
const TODAY = "2026-09-08";
const past1 = ev("past1", "2026-08-01T19:00:00+09:00");
const past2 = ev("past2", "2026-09-05T19:00:00+09:00");
const todayEv = ev("today", "2026-09-08T10:00:00+09:00");
const next1 = ev("next1", "2026-09-12T19:00:00+09:00");
const next2 = ev("next2", "2026-10-03T19:00:00+09:00");
// API は startAt 昇順で返す
const apiOrder = [past1, past2, todayEv, next1, next2];

describe("filterAndSortEvents: upcoming（今後）", () => {
  it("過去を除き、直近が先頭になる昇順で返す（先頭＝Featured）", () => {
    const out = filterAndSortEvents(apiOrder, "upcoming", TODAY).map((e) => e.eventId);
    expect(out).toEqual(["today", "next1", "next2"]);
  });

  it("今日開催のイベントは（開始時刻を過ぎていても）今後に含める", () => {
    const early = ev("early", "2026-09-08T00:30:00+09:00");
    const out = filterAndSortEvents([early], "upcoming", TODAY).map((e) => e.eventId);
    expect(out).toEqual(["early"]);
  });

  it("入力の順番に依らず並び替える（API が降順でも同じ結果）", () => {
    const reversed = [...apiOrder].reverse();
    const out = filterAndSortEvents(reversed, "upcoming", TODAY).map((e) => e.eventId);
    expect(out).toEqual(["today", "next1", "next2"]);
  });
});

describe("filterAndSortEvents: past（過去）", () => {
  it("今日より前だけを、新しい順で返す", () => {
    const out = filterAndSortEvents(apiOrder, "past", TODAY).map((e) => e.eventId);
    expect(out).toEqual(["past2", "past1"]);
  });
});

describe("filterAndSortEvents: all（すべて）", () => {
  it("全件を新しい順で返す", () => {
    const out = filterAndSortEvents(apiOrder, "all", TODAY).map((e) => e.eventId);
    expect(out).toEqual(["next2", "next1", "today", "past2", "past1"]);
  });
});

describe("filterAndSortEvents: JST の日付境界（本番は TZ=UTC）", () => {
  it("JST 0:30 開始（UTC では前日 15:30）のイベントは、その日を今日とすると今後に入る", () => {
    // UTC で日付を取ると 2026-09-07 になり「過去」に落ちる。JST で判定すること。
    const midnight = ev("midnight", "2026-09-07T15:30:00.000Z");
    expect(filterAndSortEvents([midnight], "upcoming", TODAY).map((e) => e.eventId)).toEqual(["midnight"]);
    expect(filterAndSortEvents([midnight], "past", TODAY)).toEqual([]);
  });

  it("JST 23:30 開始（UTC では同日 14:30）のイベントは、翌日を今日とすると過去に入る", () => {
    const lateNight = ev("late", "2026-09-07T14:30:00.000Z");
    expect(filterAndSortEvents([lateNight], "past", TODAY).map((e) => e.eventId)).toEqual(["late"]);
    expect(filterAndSortEvents([lateNight], "upcoming", TODAY)).toEqual([]);
  });
});

describe("filterAndSortEvents: 想定外の入力", () => {
  it("空配列は空配列を返す", () => {
    expect(filterAndSortEvents([], "upcoming", TODAY)).toEqual([]);
    expect(filterAndSortEvents([], "past", TODAY)).toEqual([]);
    expect(filterAndSortEvents([], "all", TODAY)).toEqual([]);
  });

  it("startAt が不正な日付でも例外を投げない。今後・過去には出さず、すべての末尾に置く", () => {
    const broken = ev("broken", "not-a-date");
    const empty = ev("empty", "");
    const list = [broken, next1, empty, past1];
    expect(() => filterAndSortEvents(list, "upcoming", TODAY)).not.toThrow();
    expect(filterAndSortEvents(list, "upcoming", TODAY).map((e) => e.eventId)).toEqual(["next1"]);
    expect(filterAndSortEvents(list, "past", TODAY).map((e) => e.eventId)).toEqual(["past1"]);
    expect(filterAndSortEvents(list, "all", TODAY).map((e) => e.eventId)).toEqual([
      "next1",
      "past1",
      "broken",
      "empty",
    ]);
  });

  it("入力配列を書き換えない", () => {
    const input = [...apiOrder];
    const snapshot = input.map((e) => e.eventId);
    filterAndSortEvents(input, "all", TODAY);
    expect(input.map((e) => e.eventId)).toEqual(snapshot);
  });

  it("イベント以外のフィールドを落とさない（表示用の goodCount 等をそのまま返す）", () => {
    const rich = { ...next1, goodCount: 3, liked: true };
    const out = filterAndSortEvents([rich], "upcoming", TODAY);
    expect(out[0]).toEqual(rich);
  });
});

describe("jstDateFromIso（date.ts へ移設・billing.ts からの再エクスポートも維持）", () => {
  it("UTC の ISO を JST の暦日にする", () => {
    expect(jstDateFromIso("2026-09-07T15:30:00.000Z")).toBe("2026-09-08");
    expect(jstDateFromIso("2026-09-07T14:59:59.999Z")).toBe("2026-09-07");
  });

  it("不正な文字列は空文字を返す", () => {
    expect(jstDateFromIso("not-a-date")).toBe("");
    expect(jstDateFromIso("")).toBe("");
  });

  it("billing.ts からも同じ関数が取れる（既存の import を壊さない）", async () => {
    const billing = await import("@/lib/billing");
    expect(billing.jstDateFromIso).toBe(jstDateFromIso);
  });
});
