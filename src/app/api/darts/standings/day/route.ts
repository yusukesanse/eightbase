import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { isValidDartsDate } from "@/lib/dartsEntryValidation";
import type { DartsScoreDetails, DartsEventResult } from "@/types/darts";

export const dynamic = "force-dynamic";

/**
 * GET /api/darts/standings/day?eventDate=YYYY-MM-DD
 * その開催日だけの成績（当日の総合順位＋3種目内訳）。通算（リーグタブ）とは別物。
 * scores の決定的 docId `darts-${seasonId}-${eventDate}-*`（gameId 等値）で取得。
 * 公開DTO（内部 lineUserId は返さず isMe のみ）。
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireGameUser(req);
    if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

    const season = await getActiveSeason("darts");
    const eventDate = req.nextUrl.searchParams.get("eventDate");
    if (!isValidDartsDate(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }
    if (!season) return NextResponse.json({ hasResults: false, eventDate, standings: [] });

    const gameId = `darts-${season.seasonId}-${eventDate}`;
    const snap = await getDb().collection("scores").where("gameId", "==", gameId).get();
    if (snap.empty) return NextResponse.json({ hasResults: false, eventDate, standings: [] });

    const rows = snap.docs.map((d) => {
      const x = d.data();
      return {
        lineUserId: x.lineUserId as string,
        totalPt: Number(x.totalScore) || 0,
        details: (x.details ?? {}) as DartsScoreDetails,
      };
    });

    // プロフィール一括取得。
    const uids = rows.map((r) => r.lineUserId);
    const profiles = new Map<string, { displayName: string; pictureUrl?: string }>();
    for (let i = 0; i < uids.length; i += 30) {
      const batch = uids.slice(i, i + 30);
      if (batch.length === 0) continue;
      const us = await getDb().collection("users").where("lineUserId", "in", batch).get();
      us.docs.forEach((doc) => {
        const u = doc.data();
        profiles.set(u.lineUserId, { displayName: u.displayName || "ユーザー", pictureUrl: u.pictureUrl });
      });
    }

    const standings = rows
      .sort((a, b) => (a.details.dayRank ?? 999) - (b.details.dayRank ?? 999) || b.totalPt - a.totalPt)
      .map((r) => {
        const p = profiles.get(r.lineUserId);
        const events = (r.details.events ?? []).map((e: DartsEventResult) => ({
          kind: e.kind,
          value: e.value,
          rank: e.rank,
          points: e.points,
          ...(e.teamId ? { teamId: e.teamId } : {}),
        }));
        return {
          dayRank: r.details.dayRank ?? 0,
          displayName: p?.displayName ?? "ユーザー",
          pictureUrl: p?.pictureUrl ?? "",
          totalPt: r.totalPt,
          firstCount: r.details.firstCount ?? 0,
          isMe: r.lineUserId === userId,
          events,
        };
      });

    return NextResponse.json(
      { hasResults: true, eventDate, standings },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[darts/standings/day] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
