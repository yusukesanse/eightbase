import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";
import { isRoundComplete, advanceCsRound, settleCsRounds, resolvePodium } from "@/lib/billiardsCs";
import type { BilliardsCsEvent } from "@/types/billiards";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/billiards/cs/report — CS 1対1の勝者申告（GMなし・自動進行）。
 * body: { csEventId, matchId, winnerIndex }（winnerIndex=試合内の並び順 0|1）
 * 当該試合の2名のいずれかが勝者を申告すると確定。公開DTOに lineUserId は無いため、
 * 勝者は並び順のインデックスで指定し、サーバーが match.players から id を解決する。
 * ラウンドが揃えば次を自動生成、決勝ラウンド（決勝＋任意の3位決定戦）が揃えば金/銀/銅を確定して finished。
 */
export async function PATCH(req: NextRequest) {
  try {
    const userId = await requireGameUser(req);
    if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

    const body = await req.json().catch(() => null);
    const csEventId: unknown = body?.csEventId;
    const matchId: unknown = body?.matchId;
    const winnerIndex: unknown = body?.winnerIndex;
    if (typeof csEventId !== "string" || !/^[A-Za-z0-9_-]+$/.test(csEventId)) {
      return NextResponse.json({ error: "csEventId が不正です" }, { status: 400 });
    }
    if (typeof matchId !== "string" || !matchId) {
      return NextResponse.json({ error: "matchId は必須です" }, { status: 400 });
    }
    if (winnerIndex !== 0 && winnerIndex !== 1) {
      return NextResponse.json({ error: "winnerIndex は 0 または 1 です" }, { status: 400 });
    }

    const db = getDb();
    const ref = db.collection("billiardsCsEvents").doc(csEventId);
    const now = new Date().toISOString();

    const result = await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) return { status: 404 as const, error: "CSが見つかりません" };
      const event = doc.data() as BilliardsCsEvent;
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
        return { status: 403 as const, error: "自分が参加していない試合は申告できません" };
      }
      const winner = match.players[winnerIndex];
      if (!winner) return { status: 400 as const, error: "勝者の指定が不正です" };

      // 勝敗を確定。
      match.players = match.players.map((p) => ({ ...p, won: p.lineUserId === winner.lineUserId }));
      match.status = "completed";

      let championId = event.championId ?? null;
      let runnerUpId = event.runnerUpId ?? null;
      let thirdId = event.thirdId ?? null;
      let status = event.status;

      if (isRoundComplete(round) && ri === rounds.length - 1) {
        if (round.type === "final") {
          const podium = resolvePodium(rounds);
          if (podium) {
            championId = podium.championId;
            runnerUpId = podium.runnerUpId;
            thirdId = podium.thirdId;
            status = "finished";
          }
        } else {
          const next = advanceCsRound(round, rounds.length + 1);
          if (next) { rounds.push(next); settleCsRounds(rounds); }
        }
      }

      tx.update(ref, { rounds, status, championId, runnerUpId, thirdId, updatedAt: now });
      return { status: 200 as const, eventStatus: status, championId };
    });

    if (result.status !== 200) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[billiards/cs/report] PATCH error:", error);
    return NextResponse.json({ error: "結果の反映に失敗しました" }, { status: 500 });
  }
}
