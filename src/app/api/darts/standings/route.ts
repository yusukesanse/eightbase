import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";

export const dynamic = "force-dynamic";

/**
 * GET /api/darts/standings — ダーツリーグの通算順位（シーズン合算）。
 * scores（darts）を lineUserId ごとに合算し、通算pt 降順で順位付け。
 * tier は D1(1〜4位)/D2(5〜8位)/D3(9位以下)。Figma「LEAGUE BOARD」表示用。
 *
 * 返す: standings[]（rank/displayName/pictureUrl/totalPt/games/firsts/tier/isMe）＋
 *       me（自分の順位サマリと D1昇格まで pt）＋ currentUserId。
 */

type Tier = "D1" | "D2" | "D3";
const tierOf = (rank: number): Tier => (rank <= 4 ? "D1" : rank <= 8 ? "D2" : "D3");

export async function GET(req: NextRequest) {
  try {
    const userId = await requireGameUser(req);
    if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

    const season = await getActiveSeason("darts");
    if (!season) return NextResponse.json({ standings: [], me: null, currentUserId: userId });

    const snap = await getDb().collection("scores").where("seasonId", "==", season.seasonId).get();

    // lineUserId ごとに通算pt・出場数・1位回数（その日の総合1位）を合算。
    const agg = new Map<string, { totalPt: number; games: number; firsts: number }>();
    for (const d of snap.docs) {
      const x = d.data();
      if (x.gameCategory !== "darts") continue;
      const uid = x.lineUserId as string;
      const a = agg.get(uid) ?? { totalPt: 0, games: 0, firsts: 0 };
      a.totalPt += Number(x.totalScore) || 0;
      a.games += 1;
      if (x.details && Number(x.details.dayRank) === 1) a.firsts += 1;
      agg.set(uid, a);
    }

    // プロフィール（displayName / pictureUrl）を users から一括取得。
    const uids = Array.from(agg.keys());
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

    // 通算pt 降順 → 1位回数 → 出場数 → 名前順（§footnote と一致）。
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
        displayName: p?.displayName ?? "ユーザー",
        pictureUrl: p?.pictureUrl ?? "",
        totalPt: s.totalPt,
        games: s.games,
        firsts: s.firsts,
        tier: tierOf(rank),
        isMe: s.uid === userId,
      };
    });

    // 自分のサマリ＋D1昇格まで（4位のpt - 自分のpt。D1以内なら0）。
    const meIdx = sorted.findIndex((s) => s.uid === userId);
    let me: {
      rank: number; tier: Tier; totalPt: number; games: number; firsts: number; gapToD1: number;
    } | null = null;
    if (meIdx >= 0) {
      const rank = meIdx + 1;
      const fourthPt = standings[3]?.totalPt ?? 0;
      me = {
        rank,
        tier: tierOf(rank),
        totalPt: standings[meIdx].totalPt,
        games: standings[meIdx].games,
        firsts: standings[meIdx].firsts,
        gapToD1: rank <= 4 ? 0 : Math.max(0, fourthPt - standings[meIdx].totalPt),
      };
    }

    // 各tierの人数（凡例用）。
    const counts = {
      D1: standings.filter((s) => s.tier === "D1").length,
      D2: standings.filter((s) => s.tier === "D2").length,
      D3: standings.filter((s) => s.tier === "D3").length,
    };

    return NextResponse.json(
      { standings, me, counts, currentUserId: userId, seasonName: season.name ?? null },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[darts/standings] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
