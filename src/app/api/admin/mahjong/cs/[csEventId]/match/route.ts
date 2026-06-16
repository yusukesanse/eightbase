import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { MAHJONG_TABLE_TOTAL } from "@/types";
import type { MahjongCsEvent } from "@/types";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/mahjong/cs/[csEventId]/match
 * 1試合の結果（各人の点数・順位）を入力して確定する。
 * body: { matchId: string, results: { lineUserId, points, rank }[] }
 *
 * - 4人卓は合計100,000点を検証
 * - 順位は 1..N の重複なし
 * - 決勝が確定したら championId をセットし status=finished
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ csEventId: string }> }
) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { csEventId } = await params;
    const body = await req.json().catch(() => null);
    const matchId: unknown = body?.matchId;
    const results: unknown = body?.results;

    if (typeof matchId !== "string" || !Array.isArray(results) || results.length === 0) {
      return NextResponse.json({ error: "matchId / results が不正です" }, { status: 400 });
    }
    for (const r of results) {
      if (
        typeof r?.lineUserId !== "string" ||
        typeof r?.points !== "number" ||
        !Number.isInteger(r.points) ||
        typeof r?.rank !== "number" ||
        r.rank < 1
      ) {
        return NextResponse.json(
          { error: "points は整数、rank は1以上で指定してください" },
          { status: 400 }
        );
      }
    }

    const ref = getDb().collection("mahjongCsEvents").doc(csEventId);
    const doc = await ref.get();
    if (!doc.exists) {
      return NextResponse.json({ error: "CSが見つかりません" }, { status: 404 });
    }
    const event = doc.data() as MahjongCsEvent;

    // 対象試合を探す
    let foundRoundIdx = -1;
    let foundMatchIdx = -1;
    for (let i = 0; i < event.rounds.length; i++) {
      const mi = event.rounds[i].matches.findIndex((m) => m.matchId === matchId);
      if (mi >= 0) {
        foundRoundIdx = i;
        foundMatchIdx = mi;
        break;
      }
    }
    if (foundRoundIdx < 0) {
      return NextResponse.json({ error: "試合が見つかりません" }, { status: 404 });
    }

    const round = event.rounds[foundRoundIdx];
    const match = round.matches[foundMatchIdx];

    const resultMap = new Map(
      (results as { lineUserId: string; points: number; rank: number }[]).map((r) => [
        r.lineUserId,
        r,
      ])
    );
    if (resultMap.size !== match.players.length) {
      return NextResponse.json(
        { error: "全プレイヤーの結果を入力してください" },
        { status: 400 }
      );
    }

    // 順位の重複なしチェック（1..N）
    const ranks = (results as { rank: number }[]).map((r) => r.rank).sort((a, b) => a - b);
    const expected = match.players.map((_, i) => i + 1);
    if (ranks.join(",") !== expected.join(",")) {
      return NextResponse.json(
        { error: `順位は1〜${match.players.length}を1人ずつ指定してください` },
        { status: 400 }
      );
    }

    // 4人卓は合計100,000点
    if (match.players.length === 4) {
      const total = (results as { points: number }[]).reduce((s, r) => s + r.points, 0);
      if (total !== MAHJONG_TABLE_TOTAL) {
        return NextResponse.json(
          { error: `申告合計が ${total.toLocaleString()} 点です（100,000点になる必要があります）` },
          { status: 400 }
        );
      }
    }

    // 反映
    const updatedPlayers = match.players.map((p) => {
      const r = resultMap.get(p.lineUserId)!;
      return { ...p, points: r.points, rank: r.rank };
    });
    const updatedMatch = { ...match, players: updatedPlayers, status: "completed" as const };
    const updatedRound = {
      ...round,
      matches: round.matches.map((m, i) => (i === foundMatchIdx ? updatedMatch : m)),
    };
    const updatedRounds = event.rounds.map((r, i) =>
      i === foundRoundIdx ? updatedRound : r
    );

    // 決勝が全完了 → 優勝者確定
    const patch: Partial<MahjongCsEvent> = {
      rounds: updatedRounds,
      updatedAt: new Date().toISOString(),
    };
    if (
      round.type === "final" &&
      updatedRound.matches.every((m) => m.status === "completed")
    ) {
      const finalMatch = updatedRound.matches[0];
      const champion = finalMatch.players.find((p) => p.rank === 1);
      patch.championId = champion?.lineUserId;
      patch.status = "finished";
    }

    await ref.update(patch);
    return NextResponse.json({
      success: true,
      championId: patch.championId ?? null,
      status: patch.status ?? event.status,
    });
  } catch (error) {
    console.error("[admin/mahjong/cs/:id/match] error:", error);
    return NextResponse.json({ error: "結果入力に失敗しました" }, { status: 500 });
  }
}
