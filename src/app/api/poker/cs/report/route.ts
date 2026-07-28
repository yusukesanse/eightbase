import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";
import {
  evaluatePokerCsMatch,
  isRoundComplete,
  advanceCsRound,
  settleCsRounds,
  finalPodiumSize,
  resolveFinalPodium,
} from "@/lib/pokerCs";
import type { PokerCsEvent, PokerCsMatch, PokerCsMatchPlayer } from "@/types/poker";

export const dynamic = "force-dynamic";

/** Firestore から読んだ CS event の最小ランタイム検証（as だけで信用しない）。 */
function isValidCsEvent(v: unknown): v is PokerCsEvent {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.status === "string" &&
    Array.isArray(e.rounds) &&
    Array.isArray(e.entrants)
  );
}

/**
 * PATCH /api/poker/cs/report — CSカウントアップの自己申告（GMなし・自動進行）。
 * body: { csEventId, matchId, chips }
 * 通常ラウンドは1位（通過者）の同点だけ、決勝は金・銀・銅の同点までを追加ハンドで解消する。
 * 決勝ラウンドは金・銀・銅が一意に決まるまで finished にしない。
 */
export async function PATCH(req: NextRequest) {
  try {
    const userId = await requireGameUser(req);
    if (!userId) return NextResponse.json({ error: "UNAUTHORIZED", message: "認証が必要です" }, { status: 401 });

    const body = await req.json().catch(() => null);
    const csEventId: unknown = body?.csEventId;
    const matchId: unknown = body?.matchId;
    const chips = Number(body?.chips);
    if (typeof csEventId !== "string" || !/^[A-Za-z0-9_-]+$/.test(csEventId)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "csEventId が不正です" }, { status: 400 });
    }
    if (typeof matchId !== "string" || !matchId) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "matchId は必須です" }, { status: 400 });
    }
    if (!Number.isInteger(chips) || chips < 0 || chips > 1_000_000) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "チップは0以上の整数で入力してください" }, { status: 400 });
    }

    const db = getDb();
    const ref = db.collection("pokerCsEvents").doc(csEventId);
    const now = new Date().toISOString();

    const result = await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) return { status: 404 as const, error: "NOT_FOUND", message: "CSが見つかりません" };
      const raw = doc.data();
      if (!isValidCsEvent(raw)) return { status: 500 as const, error: "CORRUPT", message: "CSデータが不正です" };
      const event = raw;
      if (event.status !== "running") {
        return { status: 409 as const, error: "NOT_RUNNING", message: "このCSは進行中ではありません" };
      }
      const rounds = event.rounds;

      let ri = -1, mi = -1;
      for (let i = 0; i < rounds.length; i++) {
        const j = rounds[i].matches.findIndex((m) => m.matchId === matchId);
        if (j >= 0) { ri = i; mi = j; break; }
      }
      if (ri < 0) return { status: 404 as const, error: "MATCH_NOT_FOUND", message: "対象の卓が見つかりません" };
      const round = rounds[ri];
      const match: PokerCsMatch = round.matches[mi];
      if (match.status === "completed") {
        return { status: 409 as const, error: "MATCH_COMPLETED", message: "この卓は確定済みです" };
      }
      if (!match.players.some((p) => p.lineUserId === userId)) {
        return { status: 403 as const, error: "NOT_PARTICIPANT", message: "自分が参加していない卓は申告できません" };
      }

      const podiumSize = round.type === "final" ? finalPodiumSize(match.players.length) : 1;

      if (match.status === "tiebreak") {
        // 追加ハンド対象（表彰対象の順位帯で同点の人）のみ tiebreakChips を送れる。
        const pre = evaluatePokerCsMatch(match, { podiumSize });
        if (!pre.tiebreakIds.includes(userId)) {
          return { status: 409 as const, error: "NOT_TIEBREAK_TARGET", message: "追加ハンドの対象ではありません" };
        }
        match.players = match.players.map((p) => (p.lineUserId === userId ? { ...p, tiebreakChips: chips } : p));
      } else {
        // 通常申告: 自分の終了時チップのみ（確定前なら再申告可）。
        match.players = match.players.map((p) => (p.lineUserId === userId ? { ...p, chips } : p));
      }

      const ev = evaluatePokerCsMatch(match, { podiumSize });
      match.status = ev.status;
      match.players = applyTiebreakGenerationReset(ev.players, ev.status, ev.tiebreakIds);

      let championId = event.championId ?? null;
      let podium = event.podium ?? null;
      let status: PokerCsEvent["status"] = event.status;

      if (ev.status === "completed" && isRoundComplete(round) && ri === rounds.length - 1) {
        if (round.type === "final") {
          const p = resolveFinalPodium(match.players);
          championId = p.gold;
          podium = { gold: p.gold, silver: p.silver, bronze: p.bronze };
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

    if (result.status !== 200) {
      return NextResponse.json({ error: result.error, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[poker/cs/report] PATCH error:", error);
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "結果の反映に失敗しました" }, { status: 500 });
  }
}

/**
 * 追加ハンド済みでもう一度同点になった組は tiebreakChips を null に戻して再入力させる（世代管理）。
 * 前回値を残さないことで「追加ハンドが再び同点なら再入力」を実現する。
 */
function applyTiebreakGenerationReset(
  players: PokerCsMatchPlayer[],
  status: "reporting" | "tiebreak" | "completed",
  tiebreakIds: string[]
): PokerCsMatchPlayer[] {
  if (status !== "tiebreak") return players;
  const inTB = new Set(tiebreakIds);
  const groups = new Map<string, PokerCsMatchPlayer[]>();
  for (const p of players) {
    if (!inTB.has(p.lineUserId)) continue;
    const k = `${p.chips}|${p.tiebreakChips ?? "n"}`;
    const arr = groups.get(k);
    if (arr) arr.push(p);
    else groups.set(k, [p]);
  }
  const resetIds = new Set<string>();
  for (const g of Array.from(groups.values())) {
    if (g.length >= 2 && g.every((p) => p.tiebreakChips != null)) {
      for (const p of g) resetIds.add(p.lineUserId);
    }
  }
  if (resetIds.size === 0) return players;
  return players.map((p) => (resetIds.has(p.lineUserId) ? { ...p, tiebreakChips: null } : p));
}
