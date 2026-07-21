/**
 * 単体テスト（再発防止）: Issue 9 — CS決勝の同点処理（金・銀・銅が一意になるまで tiebreak）。
 * ＋ Issue 2 の判定 classifyDartsCompletion。
 */
import { evaluateCsMatch, resolveFinalPodium, finalPodiumSize } from "@/lib/dartsCs";
import { classifyDartsCompletion } from "@/lib/dartsDay";
import type { DartsCsMatch, DartsCsMatchPlayer } from "@/types/darts";

const p = (id: string, score: number | null, tb: number | null = null): DartsCsMatchPlayer => ({
  lineUserId: id,
  displayName: id.toUpperCase(),
  score,
  rank: null,
  tiebreakScore: tb,
});
const m = (players: DartsCsMatchPlayer[], status: DartsCsMatch["status"] = "reporting"): DartsCsMatch => ({
  matchId: "m1",
  label: "決勝",
  players,
  status,
});

describe("evaluateCsMatch: 通常ラウンド（podiumSize=1）", () => {
  test("1位が一意なら2位以下の同点は無視して completed", () => {
    const r = evaluateCsMatch(m([p("a", 500), p("b", 400), p("c", 400)]));
    expect(r.status).toBe("completed");
    expect(r.tiebreakIds).toEqual([]);
  });
  test("1位同点は tiebreak", () => {
    const r = evaluateCsMatch(m([p("a", 500), p("b", 500), p("c", 300)]));
    expect(r.status).toBe("tiebreak");
    expect(r.tiebreakIds.sort()).toEqual(["a", "b"]);
  });
});

describe("evaluateCsMatch: 決勝（金銀銅を一意に）", () => {
  const podiumSize = finalPodiumSize(4); // =3

  test("銅を分ける同点（2位=2位）も tiebreak 対象（例: 500/400/400/300）", () => {
    const r = evaluateCsMatch(m([p("a", 500), p("b", 400), p("c", 400), p("d", 300)]), { podiumSize });
    expect(r.status).toBe("tiebreak");
    expect(r.tiebreakIds.sort()).toEqual(["b", "c"]); // 銀銅を争う2名だけ
  });

  test("追加スローで割れたら completed・金銀銅が一意（find(rank===n)に依存しない）", () => {
    const r = evaluateCsMatch(m([p("a", 500), p("b", 400, 50), p("c", 400, 40), p("d", 300)]), { podiumSize });
    expect(r.status).toBe("completed");
    const podium = resolveFinalPodium(r.players);
    expect(podium).toEqual({ gold: "a", silver: "b", bronze: "c" });
  });

  test("1位同点と3位同点が同時にあれば両方 tiebreak（500/500/400/400）", () => {
    const r = evaluateCsMatch(m([p("a", 500), p("b", 500), p("c", 400), p("d", 400)]), { podiumSize });
    expect(r.status).toBe("tiebreak");
    expect(r.tiebreakIds.sort()).toEqual(["a", "b", "c", "d"]);
  });

  test("追加スローがなお同点なら tiebreak のまま（再入力可能）", () => {
    const r = evaluateCsMatch(m([p("a", 500, 30), p("b", 500, 30), p("c", 300)]), { podiumSize: finalPodiumSize(3) });
    expect(r.status).toBe("tiebreak");
    expect(r.tiebreakIds.sort()).toEqual(["a", "b"]);
  });

  test("2名決勝は銀まで一意・銅は null 許容", () => {
    const r = evaluateCsMatch(m([p("a", 500, 40), p("b", 500, 20)]), { podiumSize: finalPodiumSize(2) });
    expect(r.status).toBe("completed");
    expect(resolveFinalPodium(r.players)).toEqual({ gold: "a", silver: "b", bronze: null });
  });
});

describe("finalPodiumSize", () => {
  test.each([
    [1, 1], [2, 2], [3, 3], [4, 3], [8, 3],
  ])("人数 %i → %i", (n, expected) => {
    expect(finalPodiumSize(n)).toBe(expected);
  });
});

describe("classifyDartsCompletion（Issue 2）", () => {
  test("中止済み → 返金待ち", () => {
    expect(classifyDartsCompletion({ cancelled: true, closed: false, isConfirmedParticipant: false, entryExists: true })).toBe("refundPending");
  });
  test("entry が消えている → 返金待ち", () => {
    expect(classifyDartsCompletion({ cancelled: false, closed: false, isConfirmedParticipant: false, entryExists: false })).toBe("refundPending");
  });
  test("締切後の非確定参加者 → 返金待ち", () => {
    expect(classifyDartsCompletion({ cancelled: false, closed: true, isConfirmedParticipant: false, entryExists: true })).toBe("refundPending");
  });
  test("締切後でも確定参加者なら paid（開始時に確定済み・通常は起きない）", () => {
    expect(classifyDartsCompletion({ cancelled: false, closed: true, isConfirmedParticipant: true, entryExists: true })).toBe("paid");
  });
  test("受付中に成立 → paid", () => {
    expect(classifyDartsCompletion({ cancelled: false, closed: false, isConfirmedParticipant: false, entryExists: true })).toBe("paid");
  });
});
