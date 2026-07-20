import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";
import { evaluateCsMatch, isRoundComplete, advanceCsRound, settleCsRounds } from "@/lib/dartsCs";
import type { DartsCsEvent } from "@/types/darts";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/darts/cs/report — CSカウントアップの自己申告（GMなし・自動進行）。
 * body: { csEventId, matchId, score }
 * 各自が自分の合計点だけ送る。全員揃うと score 降順で1位＝勝ち上がり、揃えば次ラウンドを自動生成。
 * 1位が同点なら追加スロー（match.status="tiebreak" 中は同点者が tiebreakScore を送る・§5.4）。
 * 決勝は 1位=金/2位=銀/3位=銅。
 */
export async function PATCH(req: NextRequest) {
  try {
    const userId = await requireGameUser(req);
    if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

    const body = await req.json().catch(() => null);
    const csEventId: unknown = body?.csEventId;
    const matchId: unknown = body?.matchId;
    const score = Number(body?.score);
    if (typeof csEventId !== "string" || !/^[A-Za-z0-9_-]+$/.test(csEventId)) {
      return NextResponse.json({ error: "csEventId が不正です" }, { status: 400 });
    }
    if (typeof matchId !== "string" || !matchId) {
      return NextResponse.json({ error: "matchId は必須です" }, { status: 400 });
    }
    if (!Number.isInteger(score) || score < 0 || score > 100000) {
      return NextResponse.json({ error: "点数は0以上の整数で入力してください" }, { status: 400 });
    }

    const db = getDb();
    const ref = db.collection("dartsCsEvents").doc(csEventId);
    const now = new Date().toISOString();

    const result = await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) return { status: 404 as const, error: "CSが見つかりません" };
      const event = doc.data() as DartsCsEvent;
      const rounds = event.rounds ?? [];

      let ri = -1, mi = -1;
      for (let i = 0; i < rounds.length; i++) {
        const j = rounds[i].matches.findIndex((m) => m.matchId === matchId);
        if (j >= 0) { ri = i; mi = j; break; }
      }
      if (ri < 0) return { status: 404 as const, error: "対象の試合が見つかりません" };
      const round = rounds[ri];
      const match = round.matches[mi];
      if (match.status === "completed") return { status: 400 as const, error: "この試合は確定済みです" };
      if (!match.players.some((p) => p.lineUserId === userId)) {
        return { status: 403 as const, error: "自分が参加していない組は申告できません" };
      }

      if (match.status === "tiebreak") {
        // 追加スロー: 1位同点者のみ tiebreakScore を送る。
        const topScore = Math.max(...match.players.map((p) => p.score ?? -Infinity));
        const isTied = match.players.some((p) => p.lineUserId === userId && p.score === topScore);
        if (!isTied) return { status: 400 as const, error: "追加スローの対象ではありません" };
        match.players = match.players.map((p) => (p.lineUserId === userId ? { ...p, tiebreakScore: score } : p));
      } else {
        // 通常申告: 自分の合計点のみ（確定前なら再申告可）。
        match.players = match.players.map((p) => (p.lineUserId === userId ? { ...p, score } : p));
      }

      const ev = evaluateCsMatch(match);
      match.players = ev.players;
      match.status = ev.status;

      let championId = event.championId ?? null;
      let podium = event.podium ?? null;
      let status = event.status;

      if (ev.status === "completed" && isRoundComplete(round) && ri === rounds.length - 1) {
        if (round.type === "final") {
          const players = match.players;
          const byRank = (r: number) => players.find((p) => p.rank === r) ?? null;
          const gold = byRank(1), silver = byRank(2), bronze = byRank(3);
          championId = gold?.lineUserId ?? null;
          podium = {
            gold: gold?.lineUserId ?? null,
            silver: silver?.lineUserId ?? null,
            bronze: bronze?.lineUserId ?? null,
          };
          status = "finished";
        } else {
          const next = advanceCsRound(round);
          if (next) { rounds.push(next); settleCsRounds(rounds); }
        }
      }

      tx.update(ref, { rounds, status, championId, podium, updatedAt: now });
      return {
        status: 200 as const,
        matchStatus: match.status,
        completed: ev.status === "completed",
        tiebreak: ev.status === "tiebreak",
        waiting: ev.status === "reporting",
        eventStatus: status,
        championId,
      };
    });

    if (result.status !== 200) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[darts/cs/report] PATCH error:", error);
    return NextResponse.json({ error: "結果の反映に失敗しました" }, { status: 500 });
  }
}
