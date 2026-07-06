import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";
import { isProduction } from "@/lib/env";
import { advanceCsRound, isRoundComplete, validateCsMatch } from "@/lib/mahjongCs";
import { MAHJONG_TABLE_TOTAL, type MahjongCsEvent } from "@/types";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/mahjong/cs/match  — CS結果の自己申告（本番・デモ共通）
 *
 * リーグ申告と同じ「自己申告」方式: 各ユーザーは自分の点数＋順位だけを送る
 *（他人の結果は操作不可）。同卓の全員が揃い整合すれば確定→1着のみ次ラウンドへ進出。
 * - 本番/実イベント: 各自が自分の結果のみ入力。全員揃うまで status=reporting。
 * - デモ（非本番＋demoDummy）: 同卓ダミーを自動補完して即成立。全ダミー卓は auto で自動確定。
 * 並行申告の取りこぼしを防ぐため transaction 内で更新する。
 *
 * body: { csEventId, matchId, points?, rank?, auto? }
 */

// 順位→持ち点の標準配分（人数別）。4人卓は合計100,000点。
const STD: Record<number, number[]> = {
  1: [40000],
  2: [40000, 30000],
  3: [40000, 30000, 20000],
  4: [40000, 30000, 20000, 10000],
};
const std = (n: number, rank: number) => (STD[n] ?? STD[4])[rank - 1] ?? 0;

export async function PATCH(req: NextRequest) {
  try {
    const userId = await requireGameUser(req);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const csEventId: unknown = body?.csEventId;
    const matchId: unknown = body?.matchId;
    // csEventId は doc パス。厳格に検証（インジェクション対策）。
    if (typeof csEventId !== "string" || !/^[A-Za-z0-9_-]+$/.test(csEventId)) {
      return NextResponse.json({ error: "csEventId が不正です" }, { status: 400 });
    }
    if (typeof matchId !== "string" || !matchId) {
      return NextResponse.json({ error: "matchId は必須です" }, { status: 400 });
    }
    const auto = body?.auto === true;

    const db = getDb();
    const ref = db.collection("mahjongCsEvents").doc(csEventId);
    const now = new Date().toISOString();

    const result = await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) return { status: 404 as const, error: "CSが見つかりません" };
      const event = doc.data() as MahjongCsEvent & { demoDummy?: boolean };
      const isDemo = !!event.demoDummy && !isProduction();

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
      if (roundIdx < 0) return { status: 404 as const, error: "対象の試合が見つかりません" };
      const round = rounds[roundIdx];
      const match = round.matches[matchIdx];
      if (match.status === "completed") return { status: 400 as const, error: "この試合は確定済みです" };

      const n = match.players.length;
      const iAmIn = match.players.some((p) => p.lineUserId === userId);

      if (auto) {
        // DEV-ONLY: デモの全ダミー卓を自動確定（並び順に順位・標準点）。
        if (!isDemo) return { status: 403 as const, error: "この操作はデモCSでのみ利用できます" };
        match.players = match.players.map((p, i) => ({ ...p, rank: i + 1, points: std(n, i + 1) }));
      } else {
        // 自己申告: 自分の点数＋順位のみ。同卓者であること必須（他人の結果は操作不可）。
        if (!iAmIn) return { status: 403 as const, error: "自分が参加していない卓は申告できません" };
        const points = Number(body?.points);
        const rank = Number(body?.rank);
        if (!Number.isInteger(points) || points % 100 !== 0 || points < -200000 || points > 200000) {
          return { status: 400 as const, error: "点数は100点単位の整数で入力してください" };
        }
        if (!Array.from({ length: n }, (_, i) => i + 1).includes(rank)) {
          return { status: 400 as const, error: "順位が不正です" };
        }

        if (isDemo) {
          // デモ補完: 申告した順位・点数に「整合する」点数を全員へ割り当てる。
          // 順位は降順（上位ほど高得点）、4人卓は合計100,000。自分の点数は申告値のまま。
          const otherRanks = Array.from({ length: n }, (_, i) => i + 1).filter((r) => r !== rank);
          const otherIds = match.players.filter((p) => p.lineUserId !== userId).map((p) => p.lineUserId);
          const pts: Record<number, number> = { [rank]: points };
          if (n === 4) {
            // 順位差1あたりの点差 d。d>0 なら降順で整合（1着は25,000超で成立）。
            const d = (50000 - 2 * points) / (2 * rank - 5);
            for (const r of otherRanks) pts[r] = Math.round((points + (rank - r) * d) / 100) * 100;
            const diff = [1, 2, 3, 4].reduce((s, r) => s + pts[r], 0) - MAHJONG_TABLE_TOTAL;
            pts[otherRanks[otherRanks.length - 1]] -= diff; // 最下位の他者で合計を吸収
          } else {
            for (const r of otherRanks) pts[r] = points + (rank - r) * 10000;
          }
          const rankOf = new Map<string, number>([[userId, rank]]);
          otherIds.forEach((id, i) => rankOf.set(id, otherRanks[i]));
          match.players = match.players.map((p) => {
            const r = rankOf.get(p.lineUserId) ?? p.rank ?? 1;
            return { ...p, rank: r, points: p.lineUserId === userId ? points : pts[r] };
          });
        } else {
          // 本番/実イベント: 自分の結果だけ反映（確定前なら再申告可）。
          match.players = match.players.map((p) =>
            p.lineUserId === userId ? { ...p, points, rank } : p
          );
        }
      }

      // 完了判定: 全員申告済み＆整合なら確定。未入力なら待機、合計不一致は保存して再入力を促す。
      const allReported = match.players.every((p) => p.points !== null && p.rank !== null);
      const v = allReported ? validateCsMatch(match.players) : { ok: false, error: undefined as string | undefined };
      match.status = v.ok ? "completed" : "reporting";

      let championId = event.championId;
      let status = event.status;
      if (v.ok && isRoundComplete(round) && roundIdx === rounds.length - 1) {
        if (round.type === "final") {
          const winner = round.matches.flatMap((m) => m.players).find((p) => p.rank === 1);
          championId = winner?.lineUserId;
          status = "finished";
        } else {
          const next = advanceCsRound(round);
          if (next) rounds.push(next);
        }
      }

      tx.update(ref, { rounds, status, championId: championId ?? null, updatedAt: now });
      return {
        status: 200 as const,
        completed: v.ok,
        waiting: !allReported,
        mismatch: allReported && !v.ok,
        error: allReported && !v.ok ? v.error : undefined,
        eventStatus: status,
        championId: championId ?? null,
      };
    });

    if (result.status !== 200) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({
      success: true,
      completed: result.completed,
      waiting: result.waiting,
      mismatch: result.mismatch,
      error: result.error,
      status: result.eventStatus,
      championId: result.championId,
    });
  } catch (error) {
    console.error("[mahjong/cs/match] PATCH error:", error);
    return NextResponse.json({ error: "結果の反映に失敗しました" }, { status: 500 });
  }
}
