/**
 * 点数を申告する種目（ポーカー・ダーツ）のCS申告。各自が自分の値だけを送り、卓の全員がそろったら確定。
 * 通過の境目（決勝は金銀銅の境目）に同点があれば、その人たちだけ追加勝負の値を送る。
 * 並行申告の取りこぼしを防ぐため transaction 内で更新する。麻雀は /api/mahjong/cs/match（持ち点＋着順）。
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";
import { isProduction } from "@/lib/env";
import { isManualCs } from "@/lib/mahjongCsEntry";
import { afterMatchCompleted } from "@/lib/mahjongCsBracket";
import { cutsFor, evaluateScoreMatch, podiumOf, withTiebreak } from "@/lib/gameCsMatch";
import type { GameCsRules } from "@/lib/gameCsRules";
import type { MahjongCsEvent } from "@/types";

const MAX_POINTS = 1_000_000;

export async function handleScoreMatchReport(req: NextRequest, rules: GameCsRules): Promise<NextResponse> {
  try {
    const userId = await requireGameUser(req);
    if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    const body = await req.json().catch(() => null);
    const csEventId: unknown = body?.csEventId;
    const matchId: unknown = body?.matchId;
    const auto = body?.auto === true;
    // 画面で見ていた卓の状態。送られたときだけ照合する（シートを開いている間に追加勝負へ変わった値を終了時の値として保存しない）
    const expectedStatus: unknown = body?.expectedStatus;
    // csEventId は doc パス。厳格に検証（インジェクション対策）。
    if (typeof csEventId !== "string" || !/^[A-Za-z0-9_-]+$/.test(csEventId)) {
      return NextResponse.json({ error: "csEventId が不正です" }, { status: 400 });
    }
    if (typeof matchId !== "string" || !matchId) return NextResponse.json({ error: "matchId は必須です" }, { status: 400 });
    const points = Number(body?.points);
    if (!auto && (!Number.isInteger(points) || points < 0 || points > MAX_POINTS)) {
      return NextResponse.json({ error: `${rules.scoreLabel}は0〜1,000,000の整数で入力してください` }, { status: 400 });
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
      const ri = rounds.findIndex((r) => r.matches.some((m) => m.matchId === matchId));
      if (ri < 0) return { status: 404 as const, error: "対象の試合が見つかりません" };
      const round = rounds[ri];
      const match = round.matches.find((m) => m.matchId === matchId)!;
      if (match.players.length < (match.seats ?? []).length) return { status: 409 as const, error: "この卓はまだ全員そろっていません" };
      if (match.status === "completed") return { status: 409 as const, error: "この卓は確定済みです" };
      if ((expectedStatus === "reporting" || expectedStatus === "tiebreak") && match.status !== expectedStatus) {
        return { status: 409 as const, error: "卓の状態が変わりました。画面を更新してください" };
      }
      const cuts = cutsFor(ri === rounds.length - 1, match.advanceCount ?? round.advanceCount);

      if (auto) {
        // DEV-ONLY: デモの全ダミー卓を、並び順に重ならない値で確定する
        if (!(event.demoDummy && !isProduction())) return { status: 403 as const, error: "この操作はデモCSでのみ利用できます" };
        match.players = match.players.map((p, i) => ({ ...p, points: (match.players.length - i) * 1000 }));
      } else {
        // 自己申告: 同卓者であること必須（他人の結果は操作不可）。
        if (!match.players.some((p) => p.lineUserId === userId)) {
          return { status: 403 as const, error: "自分が参加していない卓は申告できません" };
        }
        if (match.status === "tiebreak") {
          const pre = evaluateScoreMatch(match.players, cuts);
          const level = pre.tiebreakLevel[userId];
          if (!level) return { status: 409 as const, error: `${rules.tiebreakLabel}の対象ではありません` };
          match.players = withTiebreak(match.players, userId, level, points);
        } else {
          match.players = match.players.map((p) => (p.lineUserId === userId ? { ...p, points } : p));
        }
      }

      const ev = evaluateScoreMatch(match.players, cuts);
      match.players = ev.players;
      match.status = ev.status; // afterMatchCompleted は match.status === "completed" を見るので先に入れる
      let status: MahjongCsEvent["status"] = event.status; // 上の絞り込みで "running" に狭まるのを戻す
      let championId = event.championId ?? null;
      let nextRounds = rounds;
      const extra: Partial<MahjongCsEvent> = {};
      if (ev.status === "completed") {
        const done = afterMatchCompleted(event, rounds, matchId);
        nextRounds = done.rounds;
        status = done.status;
        if (status === "finished") {
          championId = done.championId ?? null;
          if (rules.writesPodium) extra.podium = podiumOf(match.players);
        }
      }
      tx.update(ref, { rounds: nextRounds, status, ...(status === "finished" ? { championId } : {}), ...extra, updatedAt: now });
      // 応答に同卓者の lineUserId（tiebreakIds・championId）は出さない。画面は res.ok と status しか見ない
      return { status: 200 as const, matchStatus: ev.status, eventStatus: status };
    });
    if (result.status !== 200) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, status: result.matchStatus, eventStatus: result.eventStatus });
  } catch (error) {
    console.error(`[${rules.game}/cs/match] PATCH error:`, error);
    return NextResponse.json({ error: "結果の反映に失敗しました" }, { status: 500 });
  }
}
