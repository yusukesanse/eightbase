import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { billiardsTierForRank, type BilliardsTier } from "@/types/billiards";

export const dynamic = "force-dynamic";

/**
 * GET /api/billiards/standings — ビリヤードの通算順位（シーズン合算）。
 * scores（billiards）を lineUserId ごとに合算し、通算pt降順で順位付け。tier=B1(1-4)/B2(5-8)/B3(9+)。
 * standings[]（rank/lineUserId/displayName/pictureUrl/totalPt/games/firsts/tier/isMe/trend）＋me＋counts。
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireGameUser(req);
    if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

    const season = await getActiveSeason("billiards");
    if (!season) return NextResponse.json({ standings: [], me: null, currentUserId: userId });

    const snap = await getDb().collection("scores").where("seasonId", "==", season.seasonId).get();

    const agg = new Map<string, { totalPt: number; games: number; firsts: number }>();
    const series = new Map<string, { date: string; pt: number }[]>();
    const embedded = new Map<string, { displayName: string; pictureUrl?: string }>();
    for (const d of snap.docs) {
      const x = d.data();
      if (x.gameCategory !== "billiards") continue;
      const uid = x.lineUserId as string;
      const pt = Number(x.totalScore) || 0;
      const a = agg.get(uid) ?? { totalPt: 0, games: 0, firsts: 0 };
      a.totalPt += pt;
      a.games += 1;
      if (x.details && Number(x.details.dayRank) === 1) a.firsts += 1;
      agg.set(uid, a);
      const s = series.get(uid) ?? [];
      s.push({ date: (x.playedAt as string) ?? (x.yearMonth as string) ?? "", pt });
      series.set(uid, s);
      if (x.displayName && !embedded.has(uid)) embedded.set(uid, { displayName: x.displayName, pictureUrl: x.pictureUrl });
    }

    const trendOf = (uid: string): number[] => {
      const s = [...(series.get(uid) ?? [])].sort((a, b) => a.date.localeCompare(b.date));
      let acc = 0;
      return s.map((x) => (acc += x.pt));
    };

    const uids = Array.from(agg.keys());
    const profiles = new Map<string, { displayName: string; pictureUrl?: string }>(embedded);
    const missing = uids.filter((u) => !profiles.has(u));
    for (let i = 0; i < missing.length; i += 30) {
      const batch = missing.slice(i, i + 30);
      if (batch.length === 0) continue;
      const us = await getDb().collection("users").where("lineUserId", "in", batch).get();
      us.docs.forEach((doc) => {
        const u = doc.data();
        profiles.set(u.lineUserId, { displayName: u.displayName || "ユーザー", pictureUrl: u.pictureUrl });
      });
    }

    const sorted = uids
      .map((uid) => ({ uid, ...(agg.get(uid) as { totalPt: number; games: number; firsts: number }) }))
      .sort((a, b) => {
        if (b.totalPt !== a.totalPt) return b.totalPt - a.totalPt;
        if (b.firsts !== a.firsts) return b.firsts - a.firsts;
        if (b.games !== a.games) return b.games - a.games;
        return (profiles.get(a.uid)?.displayName ?? "").localeCompare(profiles.get(b.uid)?.displayName ?? "", "ja");
      });

    const standings = sorted.map((s, i) => {
      const rank = i + 1;
      const p = profiles.get(s.uid);
      return {
        rank,
        lineUserId: s.uid,
        displayName: p?.displayName ?? "ユーザー",
        pictureUrl: p?.pictureUrl ?? "",
        totalPt: s.totalPt,
        games: s.games,
        firsts: s.firsts,
        tier: billiardsTierForRank(rank),
        isMe: s.uid === userId,
        trend: trendOf(s.uid),
      };
    });

    const meIdx = sorted.findIndex((s) => s.uid === userId);
    let me: { rank: number; tier: BilliardsTier; totalPt: number; games: number; firsts: number; gapToB1: number } | null = null;
    if (meIdx >= 0) {
      const rank = meIdx + 1;
      const fourthPt = standings[3]?.totalPt ?? 0;
      me = {
        rank,
        tier: billiardsTierForRank(rank),
        totalPt: standings[meIdx].totalPt,
        games: standings[meIdx].games,
        firsts: standings[meIdx].firsts,
        gapToB1: rank <= 4 ? 0 : Math.max(0, fourthPt - standings[meIdx].totalPt),
      };
    }

    const counts = {
      B1: standings.filter((s) => s.tier === "B1").length,
      B2: standings.filter((s) => s.tier === "B2").length,
      B3: standings.filter((s) => s.tier === "B3").length,
    };

    return NextResponse.json(
      { standings, me, counts, currentUserId: userId, seasonName: season.name ?? null },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[billiards/standings] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
