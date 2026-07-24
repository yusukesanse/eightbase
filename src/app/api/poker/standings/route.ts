import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { pokerTierForRank, type PokerTier } from "@/types/poker";

export const dynamic = "force-dynamic";

/**
 * GET /api/poker/standings — ポーカーの通算順位（シーズン合算）。
 * scores（poker）を lineUserId ごとに合算し、**通算チップ合計**の降順で順位付け。
 * tier=P1(1-4)/P2(5-8)/P3(9+)。standings[]（rank/…/totalChips/days/firsts/tier/isMe/trend）＋me＋counts。
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireGameUser(req);
    if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

    const season = await getActiveSeason("poker");
    if (!season) return NextResponse.json({ standings: [], me: null, currentUserId: userId });

    const snap = await getDb().collection("scores").where("seasonId", "==", season.seasonId).get();

    const agg = new Map<string, { totalChips: number; days: number; firsts: number }>();
    const series = new Map<string, { date: string; chips: number }[]>();
    const embedded = new Map<string, { displayName: string; pictureUrl?: string }>();
    for (const d of snap.docs) {
      const x = d.data();
      if (x.gameCategory !== "poker") continue;
      const uid = x.lineUserId as string;
      const chips = Number(x.totalScore) || 0;
      const a = agg.get(uid) ?? { totalChips: 0, days: 0, firsts: 0 };
      a.totalChips += chips;
      a.days += 1;
      if (x.details && Number(x.details.dayRank) === 1) a.firsts += 1;
      agg.set(uid, a);
      const s = series.get(uid) ?? [];
      s.push({ date: (x.playedAt as string) ?? (x.yearMonth as string) ?? "", chips });
      series.set(uid, s);
      if (x.displayName && !embedded.has(uid)) embedded.set(uid, { displayName: x.displayName, pictureUrl: x.pictureUrl });
    }

    const trendOf = (uid: string): number[] => {
      const s = [...(series.get(uid) ?? [])].sort((a, b) => a.date.localeCompare(b.date));
      let acc = 0;
      return s.map((x) => (acc += x.chips));
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
      .map((uid) => ({ uid, ...(agg.get(uid) as { totalChips: number; days: number; firsts: number }) }))
      .sort((a, b) => {
        if (b.totalChips !== a.totalChips) return b.totalChips - a.totalChips;
        if (b.firsts !== a.firsts) return b.firsts - a.firsts;
        if (b.days !== a.days) return b.days - a.days;
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
        totalChips: s.totalChips,
        days: s.days,
        firsts: s.firsts,
        tier: pokerTierForRank(rank),
        isMe: s.uid === userId,
        trend: trendOf(s.uid),
      };
    });

    const meIdx = sorted.findIndex((s) => s.uid === userId);
    let me: { rank: number; tier: PokerTier; totalChips: number; days: number; firsts: number; gapToP1: number } | null = null;
    if (meIdx >= 0) {
      const rank = meIdx + 1;
      const fourthChips = standings[3]?.totalChips ?? 0;
      me = {
        rank,
        tier: pokerTierForRank(rank),
        totalChips: standings[meIdx].totalChips,
        days: standings[meIdx].days,
        firsts: standings[meIdx].firsts,
        gapToP1: rank <= 4 ? 0 : Math.max(0, fourthChips - standings[meIdx].totalChips),
      };
    }

    const counts = {
      P1: standings.filter((s) => s.tier === "P1").length,
      P2: standings.filter((s) => s.tier === "P2").length,
      P3: standings.filter((s) => s.tier === "P3").length,
    };

    return NextResponse.json(
      { standings, me, counts, currentUserId: userId, seasonName: season.name ?? null },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[poker/standings] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
