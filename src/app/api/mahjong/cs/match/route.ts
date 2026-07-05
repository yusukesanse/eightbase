import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";
import { isProduction } from "@/lib/env";
import { generateNextRoundCsTop1, isRoundComplete } from "@/lib/mahjongCs";
import { MAHJONG_TABLE_TOTAL, type MahjongCsEvent, type MahjongCsMatchPlayer } from "@/types";

export const dynamic = "force-dynamic";

/**
 * DEV-ONLY（develop 専用 / main へ入れない）
 * PATCH /api/mahjong/cs/match  （デモ検証専用・非本番＋demoDummyイベントのみ）
 *
 * リーグ申告と同じ「自己申告」方式: 各ユーザーは自分の点数＋順位だけを送る
 *（他人の結果は操作不可）。同卓の全員が揃うと確定→1着のみ次ラウンドへ進出。
 * デモではダミー同卓者を自動補完して即成立させる。自分が居ない卓（全ダミー）は
 * `auto` で自動確定できる（デモ進行用）。
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

/** CS1試合の申告バリデーション（順位重複なし・整数・4人卓は合計100,000・点数と順位の整合）。 */
function validateMatch(players: MahjongCsMatchPlayer[]): { ok: boolean; error?: string } {
  const n = players.length;
  if (players.some((p) => p.points === null || p.rank === null)) {
    return { ok: false, error: "未入力があります" };
  }
  if (players.some((p) => !Number.isInteger(p.points as number))) {
    return { ok: false, error: "点数は整数で入力してください" };
  }
  const ranks = players.map((p) => p.rank as number).sort((a, b) => a - b);
  if (ranks.join(",") !== Array.from({ length: n }, (_, i) => i + 1).join(",")) {
    return { ok: false, error: "順位は1〜Nを1人ずつ入力してください" };
  }
  if (n === 4) {
    const total = players.reduce((s, p) => s + (p.points as number), 0);
    if (total !== MAHJONG_TABLE_TOTAL) {
      return { ok: false, error: `4人卓の合計は${MAHJONG_TABLE_TOTAL.toLocaleString()}点にしてください（現在 ${total.toLocaleString()}）` };
    }
  }
  for (const a of players) {
    for (const b of players) {
      if ((a.points as number) > (b.points as number) && (a.rank as number) > (b.rank as number)) {
        return { ok: false, error: "点数と順位が一致していません" };
      }
    }
  }
  return { ok: true };
}

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

    const n = match.players.length;
    const iAmIn = match.players.some((p) => p.lineUserId === userId);

    if (body?.auto === true) {
      // デモ: 自分が居ない卓（全ダミー）を自動確定（並び順に順位、標準点）。
      match.players = match.players.map((p, i) => ({ ...p, rank: i + 1, points: std(n, i + 1) }));
    } else {
      // 自己申告: 自分の点数＋順位のみ。自分が同卓であること必須（他人の操作を防ぐ）。
      if (!iAmIn) {
        return NextResponse.json({ error: "自分が参加していない卓は申告できません" }, { status: 403 });
      }
      const points = Number(body?.points);
      const rank = Number(body?.rank);
      if (!Number.isInteger(points) || points % 100 !== 0) {
        return NextResponse.json({ error: "点数は100点単位の整数で入力してください" }, { status: 400 });
      }
      if (!Array.from({ length: n }, (_, i) => i + 1).includes(rank)) {
        return NextResponse.json({ error: "順位が不正です" }, { status: 400 });
      }

      // デモ補完: 同卓のダミーへ残り順位を割り当て、4人卓は合計が100,000になるよう点数を按分。
      const otherRanks = Array.from({ length: n }, (_, i) => i + 1).filter((r) => r !== rank);
      const otherIds = match.players.filter((p) => p.lineUserId !== userId).map((p) => p.lineUserId);
      const rankOf = new Map<string, number>([[userId, rank]]);
      const pointsOf = new Map<string, number>([[userId, points]]);
      otherIds.forEach((id, i) => rankOf.set(id, otherRanks[i]));
      if (n === 4) {
        const baseSum = otherRanks.reduce((s, r) => s + std(4, r), 0);
        const need = MAHJONG_TABLE_TOTAL - points;
        const factor = baseSum > 0 ? need / baseSum : 0;
        let acc = 0;
        otherIds.forEach((id, i) => {
          const r = rankOf.get(id)!;
          const pts = i < otherIds.length - 1 ? Math.round((std(4, r) * factor) / 100) * 100 : need - acc;
          acc += i < otherIds.length - 1 ? pts : 0;
          pointsOf.set(id, pts);
        });
      } else {
        otherIds.forEach((id) => pointsOf.set(id, std(n, rankOf.get(id)!)));
      }
      match.players = match.players.map((p) => ({
        ...p,
        rank: rankOf.get(p.lineUserId) ?? p.rank,
        points: pointsOf.get(p.lineUserId) ?? p.points,
      }));

      const v = validateMatch(match.players);
      if (!v.ok) {
        return NextResponse.json({ error: v.error }, { status: 400 });
      }
    }

    match.status = "completed";

    // 確定→1着のみ進出。ラウンド全試合が揃えば次ラウンド自動生成、決勝で優勝確定。
    let championId = event.championId;
    let status = event.status;
    if (isRoundComplete(round) && roundIdx === rounds.length - 1) {
      if (round.type === "final") {
        const winner = round.matches.flatMap((m) => m.players).find((p) => p.rank === 1);
        championId = winner?.lineUserId;
        status = "finished";
      } else {
        const seeds = event.entrants.filter((e) => e.seed);
        const next = generateNextRoundCsTop1(round, seeds);
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
