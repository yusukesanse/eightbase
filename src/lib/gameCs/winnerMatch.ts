/**
 * 勝った人を申告する種目（ビリヤード）のCS申告。卓の2人がそれぞれ勝者を送り、一致したら確定。
 * 食い違いは確認待ち（disputed）で卓が止まり、片方が出し直すか管理者が確定する（/fix）。
 * 並行申告の取りこぼしを防ぐため transaction 内で更新する。点数を申告する種目は scoreMatch.ts。
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";
import { isProduction } from "@/lib/env";
import { isManualCs } from "@/lib/mahjongCsEntry";
import { afterMatchCompleted } from "@/lib/mahjongCsBracket";
import { claimWinner, settleWinner, winnerPodium } from "@/lib/gameCsWinnerMatch";
import type { GameCsRules } from "@/lib/gameCsRules";
import type { MahjongCsEvent } from "@/types";

/**
 * body: { csEventId, matchId, winnerId } または { csEventId, matchId, winner: "me" | "opponent" }
 * 画面は相手の lineUserId を持たない（公開DTOが落としている）ので、me / opponent をここで解決する。
 */
export async function handleWinnerMatchReport(req: NextRequest, rules: GameCsRules): Promise<NextResponse> {
  try {
    const userId = await requireGameUser(req);
    if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    const body = await req.json().catch(() => null);
    const csEventId: unknown = body?.csEventId;
    const matchId: unknown = body?.matchId;
    const auto = body?.auto === true;
    const expectedStatus: unknown = body?.expectedStatus;
    // csEventId は doc パス。厳格に検証（インジェクション対策）。
    if (typeof csEventId !== "string" || !/^[A-Za-z0-9_-]+$/.test(csEventId)) {
      return NextResponse.json({ error: "csEventId が不正です" }, { status: 400 });
    }
    if (typeof matchId !== "string" || !matchId) return NextResponse.json({ error: "matchId は必須です" }, { status: 400 });
    const side: unknown = body?.winner;
    const winnerIdIn: unknown = body?.winnerId;
    if (!auto && side !== "me" && side !== "opponent" && (typeof winnerIdIn !== "string" || !winnerIdIn)) {
      return NextResponse.json({ error: "勝った人を選んでください" }, { status: 400 });
    }

    const db = getDb();
    const ref = db.collection(rules.collection).doc(csEventId);
    const now = new Date().toISOString();
    const result = await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) return { status: 404 as const, error: "CSが見つかりません" };
      const event = doc.data() as MahjongCsEvent;
      if (!isManualCs(event)) return { status: 409 as const, error: "旧形式のCSには申告できません" };
      if (event.status === "finished") return { status: 409 as const, error: "この大会は終了しています" };
      if (event.status !== "running") return { status: 409 as const, error: "対戦はまだ始まっていません" };
      const rounds = structuredClone(event.rounds ?? []);
      const round = rounds.find((r) => r.matches.some((m) => m.matchId === matchId));
      if (!round) return { status: 404 as const, error: "対象の試合が見つかりません" };
      const mi = round.matches.findIndex((m) => m.matchId === matchId);
      const match = round.matches[mi];
      if (match.players.length < (match.seats ?? []).length) return { status: 409 as const, error: "この卓はまだ全員そろっていません" };
      if (match.status === "completed") return { status: 409 as const, error: "この卓は確定済みです" };
      if ((expectedStatus === "reporting" || expectedStatus === "disputed") && match.status !== expectedStatus) {
        return { status: 409 as const, error: "卓の状態が変わりました。画面を更新してください" };
      }

      if (auto) {
        // DEV-ONLY: デモの全ダミー卓を、席順の先頭を勝者にして確定する
        if (!(event.demoDummy && !isProduction())) return { status: 403 as const, error: "この操作はデモCSでのみ利用できます" };
        round.matches[mi] = { ...match, status: "completed", players: settleWinner(match.players, match.players[0].lineUserId) };
      } else {
        // 自己申告: 同卓者であること必須（他人の卓は操作不可）。
        if (!match.players.some((p) => p.lineUserId === userId)) {
          return { status: 403 as const, error: "自分が参加していない卓は申告できません" };
        }
        const winnerId = side === "me" ? userId
          : side === "opponent" ? match.players.find((p) => p.lineUserId !== userId)?.lineUserId
          : winnerIdIn as string;
        const claimed = claimWinner(match, userId, winnerId ?? "");
        if (!claimed.ok) return { status: 400 as const, error: "勝った人は同じ卓の2人から選んでください" };
        round.matches[mi] = claimed.match;
      }

      const matchStatus = round.matches[mi].status;
      let status: MahjongCsEvent["status"] = event.status; // 上の絞り込みで "running" に狭まるのを戻す
      let nextRounds = rounds;
      const extra: Partial<MahjongCsEvent> = {};
      if (matchStatus === "completed") {
        const done = afterMatchCompleted(event, rounds, matchId);
        nextRounds = done.rounds;
        status = done.status;
        // 表彰は確定した卓ではなく rounds 全体から（3位決定戦が最後に確定することがある）
        if (status === "finished") Object.assign(extra, { championId: done.championId ?? null, podium: winnerPodium(nextRounds) });
      }
      tx.update(ref, { rounds: nextRounds, status, ...extra, updatedAt: now });
      // 応答に同卓者の lineUserId は出さない。画面は res.ok と status しか見ない
      return { status: 200 as const, matchStatus, eventStatus: status };
    });
    if (result.status !== 200) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, status: result.matchStatus, eventStatus: result.eventStatus });
  } catch (error) {
    console.error(`[${rules.game}/cs/match] PATCH error:`, error);
    return NextResponse.json({ error: "結果の反映に失敗しました" }, { status: 500 });
  }
}
