import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { validateCsMatch, isRoundComplete, generateNextRoundCsTop1 } from "@/lib/mahjongCs";
import { writeAuditLog } from "@/lib/auditLog";
import type { MahjongCsEvent } from "@/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/mahjong/cs/[csEventId]/fix — 障害時の管理者手修正
 * body:
 *  { action: "resetBracket" }
 *      … 進行をリセット（rounds空・status=setup）。確定日到来で予選が再生成される。
 *  { action: "editMatch", matchId, results: [{ lineUserId, points, rank }] }
 *      … 指定試合の結果を管理者が上書き確定。以降のラウンドは破棄して整合を取り直す。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ csEventId: string }> }
) {
  const admin = await checkAdminAuth(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { csEventId } = await params;
  if (!/^[A-Za-z0-9_-]+$/.test(csEventId)) {
    return NextResponse.json({ error: "csEventId が不正です" }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  const action: unknown = body?.action;
  const db = getDb();
  const ref = db.collection("mahjongCsEvents").doc(csEventId);
  const now = new Date().toISOString();

  try {
    if (action === "resetBracket") {
      const ok = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return false;
        tx.update(ref, { rounds: [], status: "setup", championId: null, updatedAt: now });
        return true;
      });
      if (!ok) return NextResponse.json({ error: "CSが見つかりません" }, { status: 404 });
      await writeAuditLog({ eventType: "cs.reset", actor: admin, target: {}, meta: { csEventId } });
      return NextResponse.json({ success: true });
    }

    if (action === "editMatch") {
      const matchId: unknown = body?.matchId;
      const results: unknown = body?.results;
      if (typeof matchId !== "string" || !Array.isArray(results)) {
        return NextResponse.json({ error: "matchId と results が必要です" }, { status: 400 });
      }
      const byId = new Map<string, { points: number; rank: number }>(
        results.map((r) => [String(r?.lineUserId), { points: Number(r?.points), rank: Number(r?.rank) }])
      );

      const out = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { status: 404 as const, error: "CSが見つかりません" };
        const event = snap.data() as MahjongCsEvent;
        const rounds = event.rounds ?? [];
        let ri = -1;
        let mi = -1;
        for (let i = 0; i < rounds.length; i++) {
          const j = rounds[i].matches.findIndex((m) => m.matchId === matchId);
          if (j >= 0) { ri = i; mi = j; break; }
        }
        if (ri < 0) return { status: 404 as const, error: "対象の試合が見つかりません" };
        const round = rounds[ri];
        const match = round.matches[mi];

        if (match.players.some((p) => !byId.has(p.lineUserId))) {
          return { status: 400 as const, error: "同卓者全員分の結果を入力してください" };
        }
        match.players = match.players.map((p) => {
          const r = byId.get(p.lineUserId)!;
          return { ...p, points: r.points, rank: r.rank };
        });
        const v = validateCsMatch(match.players);
        if (!v.ok) return { status: 400 as const, error: v.error };
        match.status = "completed";

        // この結果に依存する後続ラウンドは破棄し、整合を取り直す。
        const trimmed = rounds.slice(0, ri + 1);
        let championId: string | null = null;
        let status = event.status;
        if (isRoundComplete(round)) {
          if (round.type === "final") {
            const winner = round.matches.flatMap((m) => m.players).find((p) => p.rank === 1);
            championId = winner?.lineUserId ?? null;
            status = "finished";
          } else {
            const seeds = event.entrants.filter((e) => e.seed);
            const next = generateNextRoundCsTop1(round, seeds);
            if (next) trimmed.push(next);
            status = "running";
          }
        } else {
          status = "running";
        }
        tx.update(ref, { rounds: trimmed, status, championId, updatedAt: now });
        return { status: 200 as const, championId };
      });

      if (out.status !== 200) return NextResponse.json({ error: out.error }, { status: out.status });
      await writeAuditLog({ eventType: "cs.matchEdited", actor: admin, target: {}, meta: { csEventId, matchId } });
      return NextResponse.json({ success: true, championId: out.championId });
    }

    return NextResponse.json({ error: "action が不正です" }, { status: 400 });
  } catch (error) {
    console.error("[admin/mahjong/cs/:id/fix] error:", error);
    return NextResponse.json({ error: "手修正に失敗しました" }, { status: 500 });
  }
}
