import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { validateCsMatch, isRoundComplete, advanceCsRound } from "@/lib/mahjongCs";
import { afterMatchCompleted } from "@/lib/mahjongCsBracket";
import { isManualCs } from "@/lib/mahjongCsEntry";
import { writeAuditLog } from "@/lib/auditLog";
import type { MahjongCsEvent } from "@/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/mahjong/cs/[csEventId]/fix — 障害時の管理者手修正
 * body:
 *  { action: "resetBracket" }
 *      … 新方式は編成を保持してclosedへ戻す（rounds空・championId削除）。
 *        旧方式はsetupへ戻し、確定日到来で予選が再生成される。
 *  { action: "editMatch", matchId, results: [{ lineUserId, points, rank }] }
 *      … 指定試合の結果を管理者が上書き確定。新方式は後続ラウンドを保持して札の席を再充填
 *        （次の卓が申告済みなら409）。旧方式は以降のラウンドを破棄して整合を取り直す。
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
      const out = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { status: 404 as const, error: "CSが見つかりません" };
        const event = snap.data() as MahjongCsEvent;
        if (isManualCs(event)) {
          if (event.status !== "running" && event.status !== "finished") {
            return { status: 409 as const, error: "現在の状態ではこの操作はできません" };
          }
          tx.update(ref, { status: "closed", rounds: [], championId: FieldValue.delete(), updatedAt: now });
          return { status: 200 as const, eventType: "cs.bracketReopened" as const };
        }
        tx.update(ref, { rounds: [], status: "setup", championId: null, updatedAt: now });
        return { status: 200 as const, eventType: "cs.reset" as const };
      });
      if (out.status !== 200) return NextResponse.json({ error: out.error }, { status: out.status });
      await writeAuditLog({ eventType: out.eventType, actor: admin, target: {}, meta: { csEventId } });
      return NextResponse.json({ success: true });
    }

    if (action === "editMatch") {
      const matchId: unknown = body?.matchId;
      const results: unknown = body?.results;
      if (typeof matchId !== "string" || !Array.isArray(results)) {
        return NextResponse.json({ error: "matchId と results が必要です" }, { status: 400 });
      }
      if (results.some((r) => {
        const points = Number(r?.points);
        return !Number.isInteger(points) || points % 100 !== 0 || points < -200000 || points > 200000;
      })) {
        return NextResponse.json({ error: "点数は100点単位の整数で入力してください" }, { status: 400 });
      }
      const byId = new Map<string, { points: number; rank: number }>(
        results.map((r) => [String(r?.lineUserId), { points: Number(r?.points), rank: Number(r?.rank) }])
      );

      const out = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { status: 404 as const, error: "CSが見つかりません" };
        const event = snap.data() as MahjongCsEvent;
        if (isManualCs(event) && event.status !== "running" && event.status !== "finished") {
          return { status: 409 as const, error: "現在の状態ではこの操作はできません" };
        }
        const rounds = isManualCs(event) ? structuredClone(event.rounds ?? []) : event.rounds ?? [];
        let ri = -1;
        let mi = -1;
        for (let i = 0; i < rounds.length; i++) {
          const j = rounds[i].matches.findIndex((m) => m.matchId === matchId);
          if (j >= 0) { ri = i; mi = j; break; }
        }
        if (ri < 0) return { status: 404 as const, error: "対象の試合が見つかりません" };
        const round = rounds[ri];
        const match = round.matches[mi];

        if (isManualCs(event) && match.players.length < 4) {
          return { status: 409 as const, error: "この卓はまだ全員そろっていません" };
        }
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

        if (isManualCs(event)) {
          let completed;
          try {
            completed = afterMatchCompleted(event, rounds, matchId);
          } catch (error) {
            if (error instanceof Error && error.message === "DOWNSTREAM_REPORTED") {
              return { status: 409 as const, error: "次の卓に結果が入っているため修正できません。先に次の卓の結果を直すか、編成に戻してください" };
            }
            throw error;
          }
          tx.update(ref, { ...completed, updatedAt: now });
          return { status: 200 as const, championId: completed.championId ?? null };
        }

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
            const next = advanceCsRound(round);
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
