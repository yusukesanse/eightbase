import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { isValidBilliardsDate } from "@/lib/billiardsEntryValidation";
import type { BilliardsScoreDetails } from "@/types/billiards";

export const dynamic = "force-dynamic";

/**
 * GET /api/billiards/standings/day?eventDate=YYYY-MM-DD
 * その開催日だけの成績（当日順位＋各試合の勝敗内訳）。通算（リーグタブ）とは別物。
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireGameUser(req);
    if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

    const season = await getActiveSeason("billiards");
    const eventDate = req.nextUrl.searchParams.get("eventDate");
    if (!isValidBilliardsDate(eventDate)) return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    if (!season) return NextResponse.json({ hasResults: false, eventDate, standings: [] });

    const gameId = `billiards-${season.seasonId}-${eventDate}`;
    const snap = await getDb().collection("scores").where("gameId", "==", gameId).get();
    if (snap.empty) return NextResponse.json({ hasResults: false, eventDate, standings: [] });

    const rows = snap.docs.map((d) => {
      const x = d.data();
      return {
        lineUserId: x.lineUserId as string,
        totalPt: Number(x.totalScore) || 0,
        details: (x.details ?? {}) as BilliardsScoreDetails,
        displayName: (x.displayName as string) || "",
        pictureUrl: (x.pictureUrl as string) || "",
      };
    });

    const profiles = new Map<string, { displayName: string; pictureUrl?: string }>();
    rows.forEach((r) => { if (r.displayName) profiles.set(r.lineUserId, { displayName: r.displayName, pictureUrl: r.pictureUrl }); });
    const missing = rows.map((r) => r.lineUserId).filter((u) => !profiles.has(u));
    for (let i = 0; i < missing.length; i += 30) {
      const batch = missing.slice(i, i + 30);
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
        return {
          dayRank: r.details.dayRank ?? 0,
          displayName: p?.displayName ?? "ユーザー",
          pictureUrl: p?.pictureUrl ?? "",
          totalPt: r.totalPt,
          wins: r.details.wins ?? 0,
          losses: r.details.losses ?? 0,
          isMe: r.lineUserId === userId,
          matches: (r.details.matches ?? []).map((m) => ({ result: m.result, points: m.points, opponentName: m.opponentName ?? "" })),
        };
      });

    return NextResponse.json({ hasResults: true, eventDate, standings }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[billiards/standings/day] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
