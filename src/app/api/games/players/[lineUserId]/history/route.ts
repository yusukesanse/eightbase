import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import type { ScoreboardGameId } from "@/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/games/players/[lineUserId]/history?gameCategory=&seasonId=
 * 汎用スコアボード（darts / poker / billiards）のプレイヤー戦歴。麻雀と同じ基本UI用。
 * 麻雀は別実装（/api/mahjong/players/... 。データモデルが mahjongTables で異なる）。
 *
 * 認可: requireGameUser（ログイン必須の公開競技データ）。
 */

const VALID: ScoreboardGameId[] = ["darts", "poker", "billiards"];

/** 種目ごとの「1試合の見出し・pt・1位か」を details から導出。 */
function perGame(gameCategory: string, totalScore: number, details: Record<string, unknown> | undefined): {
  pt: number;
  label: string;
  isFirst: boolean;
} {
  const d = details ?? {};
  if (gameCategory === "darts") {
    const rank = Number(d.dayRank) || 0;
    return { pt: totalScore, label: rank ? `${rank}位` : "—", isFirst: rank === 1 };
  }
  if (gameCategory === "poker") {
    const rank = Number(d.tournamentRank) || 0;
    return { pt: totalScore, label: rank ? `${rank}位` : "—", isFirst: rank === 1 };
  }
  // billiards: matches の勝敗
  const matches = Array.isArray(d.matches) ? (d.matches as { result?: string }[]) : [];
  const w = matches.filter((m) => m.result === "win").length;
  const l = matches.filter((m) => m.result === "lose").length;
  return { pt: totalScore, label: matches.length ? `${w}勝${l}敗` : "—", isFirst: w > 0 && l === 0 };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ lineUserId: string }> }) {
  try {
    const userId = await requireGameUser(req);
    if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

    const targetId = decodeURIComponent((await params).lineUserId);
    const gameCategory = req.nextUrl.searchParams.get("gameCategory") ?? "";
    if (!VALID.includes(gameCategory as ScoreboardGameId)) {
      return NextResponse.json({ error: "gameCategory が不正です" }, { status: 400 });
    }

    let seasonId = req.nextUrl.searchParams.get("seasonId");
    if (!seasonId) {
      const season = await getActiveSeason(gameCategory as ScoreboardGameId);
      if (!season) return NextResponse.json({ player: null, summary: null, trend: [], games: [], gameCategory });
      seasonId = season.seasonId;
    }

    const snap = await getDb().collection("scores").where("seasonId", "==", seasonId).get();

    // シーズン内 gameCategory の全レコードを集計（順位算出）＋対象の試合を収集。
    const totals = new Map<string, number>();
    let player: { displayName: string; pictureUrl?: string } | null = null;
    const myGames: { date: string; pt: number; label: string; isFirst: boolean }[] = [];
    for (const doc of snap.docs) {
      const x = doc.data();
      if (x.gameCategory !== gameCategory) continue;
      const uid = x.lineUserId as string;
      const pt = Number(x.totalScore) || 0;
      totals.set(uid, (totals.get(uid) ?? 0) + pt);
      if (uid === targetId) {
        const g = perGame(gameCategory, pt, x.details);
        myGames.push({ date: (x.playedAt as string) ?? (x.yearMonth as string) ?? "", pt: g.pt, label: g.label, isFirst: g.isFirst });
        if (x.displayName) player = { displayName: x.displayName, pictureUrl: x.pictureUrl };
      }
    }

    // 名前が埋め込まれていなければ users から補完。
    if (!player) {
      const u = (await getDb().collection("users").doc(targetId).get()).data();
      player = { displayName: u?.displayName || "ユーザー", pictureUrl: u?.pictureUrl };
    }

    if (myGames.length === 0) {
      return NextResponse.json({ player, summary: null, trend: [], games: [], gameCategory });
    }

    // 通算pt順の順位。
    const ranked = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const rank = ranked.indexOf(targetId) + 1;

    // 日付昇順で累積pt（推移）／表示は新しい順。
    const asc = [...myGames].sort((a, b) => a.date.localeCompare(b.date));
    let acc = 0;
    const trend = asc.map((g) => (acc += g.pt));
    const totalPt = asc.reduce((s, g) => s + g.pt, 0);
    const firsts = myGames.filter((g) => g.isFirst).length;

    return NextResponse.json(
      {
        player,
        gameCategory,
        summary: {
          games: myGames.length,
          totalPt,
          avgPt: Math.round(totalPt / myGames.length),
          rank,
          firsts,
        },
        trend,
        games: [...myGames].sort((a, b) => b.date.localeCompare(a.date)),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[games/players/history] GET error:", error);
    return NextResponse.json({ error: "戦歴の取得に失敗しました" }, { status: 500 });
  }
}
