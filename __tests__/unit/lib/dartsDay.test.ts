/**
 * 単体テスト: src/lib/dartsDay.ts の純粋部分（受付締切・種目結果・当日集計）。
 * 要件 docs/games/darts/ダーツ-ルール草案.md §3.1〜§3.5。
 *
 * transaction 系（start/report/finish/cancel）は麻雀 day フローの読み替えで、
 * この repo の慣例どおり API 通し（demo）で検証する。ここでは順位ポイントの算出ロジックを固める。
 */
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: () => ({}) }));

import {
  isDartsEntryClosed,
  computeDartsEventResults,
  computeDartsDayScores,
} from "@/lib/dartsDay";
import type { DartsDayState, DartsEventState, DartsDayMember, DartsTeam } from "@/types/darts";

const member = (id: string): DartsDayMember => ({ lineUserId: id, displayName: id.toUpperCase() });

const rep = (entries: Record<string, number | null>): DartsEventState["reports"] =>
  Object.fromEntries(
    Object.entries(entries).map(([k, v]) => [k, { value: v, reportedAt: "2026-07-16T10:00:00.000Z" }])
  );

function buildDay(over: Partial<DartsDayState> = {}): DartsDayState {
  return {
    seasonId: "s1",
    eventDate: "2026-07-16",
    participants: ["A", "B", "C", "D"].map(member),
    entryClosedAt: "2026-07-16T09:00:00.000Z",
    startedBy: "gm1",
    zeroOneVariant: { start: 301, out: "double" },
    cricketTeams: null,
    events: [
      { kind: "zeroOne", status: "confirmed", reports: {} },
      { kind: "countUp", status: "confirmed", reports: {} },
      { kind: "cricket", status: "confirmed", reports: {} },
    ],
    finishedAt: null,
    finishedBy: null,
    updatedAt: "2026-07-16T10:00:00.000Z",
    ...over,
  };
}

describe("isDartsEntryClosed", () => {
  test("dayState 無し＝受付中", () => expect(isDartsEntryClosed(null)).toBe(false));
  test("entryClosedAt 無し＝受付中", () =>
    expect(isDartsEntryClosed(buildDay({ entryClosedAt: null }))).toBe(false));
  test("GM 開始済み＝締切", () => expect(isDartsEntryClosed(buildDay())).toBe(true));
});

describe("computeDartsEventResults", () => {
  test("ゼロワン: 残り点の少ない順（0が最上位・低いほど上位）", () => {
    const day = buildDay();
    const ev: DartsEventState = { kind: "zeroOne", status: "confirmed", reports: rep({ A: 0, B: 50, D: 100, C: 150 }) };
    const r = computeDartsEventResults(day, ev);
    const by = Object.fromEntries(r.map((x) => [x.lineUserId, x]));
    expect(by.A).toMatchObject({ rank: 1, points: 8 });
    expect(by.B).toMatchObject({ rank: 2, points: 5.5 });
    expect(by.D).toMatchObject({ rank: 3, points: 3.5 });
    expect(by.C).toMatchObject({ rank: 4, points: 1 });
  });

  test("カウントアップ: 合計点の高い順", () => {
    const day = buildDay();
    const ev: DartsEventState = { kind: "countUp", status: "confirmed", reports: rep({ B: 500, A: 400, D: 300, C: 200 }) };
    const by = Object.fromEntries(computeDartsEventResults(day, ev).map((x) => [x.lineUserId, x]));
    expect(by.B).toMatchObject({ rank: 1, points: 8 });
    expect(by.A).toMatchObject({ rank: 2, points: 5.5 });
    expect(by.C).toMatchObject({ rank: 4, points: 1 });
  });

  test("同点は平均分配（§3.1）", () => {
    const day = buildDay();
    // A,B が最高で同点 → 1・2位平均 = (8+5.5)/2 = 6.75 ずつ
    const ev: DartsEventState = { kind: "countUp", status: "confirmed", reports: rep({ A: 500, B: 500, C: 300, D: 200 }) };
    const by = Object.fromEntries(computeDartsEventResults(day, ev).map((x) => [x.lineUserId, x]));
    expect(by.A).toMatchObject({ rank: 1, points: 6.75 });
    expect(by.B).toMatchObject({ rank: 1, points: 6.75 });
    expect(by.C).toMatchObject({ rank: 3, points: 3.5 });
  });

  test("棄権(null)は 0pt・人数外（§3.2）", () => {
    const day = buildDay();
    const ev: DartsEventState = { kind: "countUp", status: "confirmed", reports: rep({ A: 400, B: 300, C: 200, D: null }) };
    const by = Object.fromEntries(computeDartsEventResults(day, ev).map((x) => [x.lineUserId, x]));
    // 有効3名: A1=8 / B2=4.5 / C3=1、D=棄権0
    expect(by.A).toMatchObject({ rank: 1, points: 8 });
    expect(by.B).toMatchObject({ rank: 2, points: 4.5 });
    expect(by.C).toMatchObject({ rank: 3, points: 1 });
    expect(by.D).toMatchObject({ rank: null, points: 0 });
  });

  test("クリケット: チーム帯平均（§3.3・8名4チーム）", () => {
    const teams: DartsTeam[] = [
      { teamId: "t1", memberIds: ["A", "B"] },
      { teamId: "t2", memberIds: ["C", "D"] },
      { teamId: "t3", memberIds: ["E", "F"] },
      { teamId: "t4", memberIds: ["G", "H"] },
    ];
    const day = buildDay({
      participants: ["A", "B", "C", "D", "E", "F", "G", "H"].map(member),
      cricketTeams: teams,
    });
    const ev: DartsEventState = {
      kind: "cricket",
      status: "confirmed",
      reports: rep({ t1: 100, t2: 80, t3: 60, t4: 40 }),
    };
    const by = Object.fromEntries(computeDartsEventResults(day, ev).map((x) => [x.lineUserId, x]));
    // 1位帯(1,2位)平均=7.5 / 2位帯=5.5 / 3位帯=3.5 / 4位帯=1.5
    expect(by.A).toMatchObject({ teamId: "t1", rank: 1, points: 7.5 });
    expect(by.B).toMatchObject({ teamId: "t1", rank: 1, points: 7.5 });
    expect(by.C).toMatchObject({ rank: 2, points: 5.5 });
    expect(by.G).toMatchObject({ rank: 4, points: 1.5 });
  });
});

describe("computeDartsDayScores（3種目合算・§3.5 の4名例）", () => {
  // クリケットは1人チーム×4で §3.5 の個人イメージを再現（A>C>D>B）。
  const day = buildDay({
    cricketTeams: [
      { teamId: "tA", memberIds: ["A"] },
      { teamId: "tC", memberIds: ["C"] },
      { teamId: "tD", memberIds: ["D"] },
      { teamId: "tB", memberIds: ["B"] },
    ],
    events: [
      { kind: "zeroOne", status: "confirmed", reports: rep({ A: 0, B: 50, D: 100, C: 150 }) },
      { kind: "countUp", status: "confirmed", reports: rep({ B: 500, A: 400, D: 300, C: 200 }) },
      { kind: "cricket", status: "confirmed", reports: rep({ tA: 100, tC: 80, tD: 60, tB: 40 }) },
    ],
  });
  const scores = computeDartsDayScores(day);
  const by = Object.fromEntries(scores.map((s) => [s.lineUserId, s]));

  test("合計ポイント（§3.5）", () => {
    expect(by.A.totalScore).toBe(21.5); // 8 + 5.5 + 8
    expect(by.B.totalScore).toBe(14.5); // 5.5 + 8 + 1
    expect(by.D.totalScore).toBe(10.5); // 3.5 + 3.5 + 3.5
    expect(by.C.totalScore).toBe(7.5); // 1 + 1 + 5.5
  });

  test("当日順位: A1 / B2 / D3 / C4（§3.5）", () => {
    expect(by.A.details.dayRank).toBe(1);
    expect(by.B.details.dayRank).toBe(2);
    expect(by.D.details.dayRank).toBe(3);
    expect(by.C.details.dayRank).toBe(4);
  });

  test("1位数（タイブレーク用）: A は ゼロワン+クリケットで2", () => {
    expect(by.A.details.firstCount).toBe(2);
    expect(by.B.details.firstCount).toBe(1); // CU 1位
    expect(by.C.details.firstCount).toBe(0);
  });

  test("details.events は3種目・kind/points/rank を保持", () => {
    expect(by.A.details.events.map((e) => e.kind)).toEqual(["zeroOne", "countUp", "cricket"]);
    expect(by.A.details.events[0]).toMatchObject({ rank: 1, points: 8, value: 0 });
    expect(by.A.details.events[2]).toMatchObject({ teamId: "tA", rank: 1, points: 8 });
  });
});
