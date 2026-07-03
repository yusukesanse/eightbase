import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";
import { isProduction } from "@/lib/env";
import { generateNextRound, isRoundComplete } from "@/lib/mahjongCs";
import type { MahjongCsEvent } from "@/types";

export const dynamic = "force-dynamic";

/**
 * DEV-ONLY（develop 専用 / main へ入れない）
 * PATCH /api/mahjong/cs/match  （デモ検証専用・非本番＋demoDummyイベントのみ）
 *
 * demoユーザー1人でCSトーナメントを進められるようにする利用者向け入力。
 * 本番のCS結果入力は管理者API（/api/admin/mahjong/cs/[id]/match）が担う。ここは触らない。
 *
 * body: { csEventId: string, matchId: string, meRank?: number, winnerId?: string }
 *  - meRank: demoユーザーが同卓のとき、その順位（1着=勝ち上がり）。他プレイヤーは残り順位で補完。
 *  - winnerId: demoユーザーが居ない卓で「1着（勝者）」に指定するプレイヤー。残りは並び順で補完。
 *  いずれも手動指定。合致が無ければ並び順で順位付け。
 *
 * 1試合を completed にし、ラウンドが揃えば次ラウンドを自動生成、決勝完了で優勝確定(finished)。
 */
export async function PATCH(req: NextRequest) {
  try {
    if (isProduction()) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const userId = await requireGameUser(req);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const csEventId: unknown = body?.csEventId;
    const matchId: unknown = body?.matchId;
    const meRank: unknown = body?.meRank;
    const winnerId: unknown = body?.winnerId;
    if (typeof csEventId !== "string" || typeof matchId !== "string") {
      return NextResponse.json({ error: "csEventId と matchId は必須です" }, { status: 400 });
    }

    const db = getDb();
    const ref = db.collection("mahjongCsEvents").doc(csEventId);
    const doc = await ref.get();
    if (!doc.exists) {
      return NextResponse.json({ error: "CSが見つかりません" }, { status: 404 });
    }
    const event = doc.data() as MahjongCsEvent & { demoDummy?: boolean };

    // デモ卓（demoDummy）以外は受け付けない（本番仕様を壊さないための保険）
    if (!event.demoDummy) {
      return NextResponse.json({ error: "この操作はデモCSでのみ利用できます" }, { status: 403 });
    }

    const rounds = event.rounds ?? [];
    let roundIdx = -1;
    let matchIdx = -1;
    for (let i = 0; i < rounds.length; i++) {
      const mi = rounds[i].matches.findIndex((m) => m.matchId === matchId);
      if (mi >= 0) {
        roundIdx = i;
        matchIdx = mi;
        break;
      }
    }
    if (roundIdx < 0) {
      return NextResponse.json({ error: "対象の試合が見つかりません" }, { status: 404 });
    }
    const round = rounds[roundIdx];
    const match = round.matches[matchIdx];
    if (match.status === "completed") {
      return NextResponse.json({ error: "この試合は確定済みです" }, { status: 400 });
    }

    // 順位割り当て（手動指定）: 同卓の demoユーザーは meRank、居ない卓は winnerId を1着に。
    // 指定プレイヤーを固定し、残りは並び順で順位を埋める。点数は順位から機械的に。
    const n = match.players.length;
    const hasMe = match.players.some((p) => p.lineUserId === userId);
    let anchorId: string | null = null;
    let anchorRank: number | null = null;
    if (hasMe) {
      anchorId = userId;
      anchorRank = Math.min(Math.max(Number(meRank) || 1, 1), n);
    } else if (typeof winnerId === "string" && match.players.some((p) => p.lineUserId === winnerId)) {
      anchorId = winnerId;
      anchorRank = 1;
    }
    const remaining = Array.from({ length: n }, (_, i) => i + 1).filter((r) => r !== anchorRank);
    let ri = 0;
    match.players = match.players.map((p) => {
      const rank = p.lineUserId === anchorId && anchorRank ? anchorRank : remaining[ri++];
      return { ...p, rank, points: 40000 - (rank - 1) * 10000 };
    });
    match.status = "completed";

    // ラウンドが揃ったら次へ。最終ラウンドかつ最新ラウンドのときだけ進行させる（二重生成防止）。
    let championId = event.championId;
    let status = event.status;
    if (isRoundComplete(round) && roundIdx === rounds.length - 1) {
      if (round.type === "final") {
        const winner = round.matches.flatMap((m) => m.players).find((p) => p.rank === 1);
        championId = winner?.lineUserId;
        status = "finished";
      } else {
        const seeds = event.entrants.filter((e) => e.seed);
        const next = generateNextRound(round, seeds);
        if (next) rounds.push(next);
      }
    }

    await ref.update({
      rounds,
      status,
      championId: championId ?? null,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, status, championId: championId ?? null });
  } catch (error) {
    console.error("[mahjong/cs/match] PATCH error:", error);
    return NextResponse.json({ error: "結果の反映に失敗しました" }, { status: 500 });
  }
}
