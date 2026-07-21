import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/games/standings?gameCategory=&seasonId=
 * 管理画面用の通算順位（種目別・シーズン合算）。scores を lineUserId ごとに合算し、
 * 通算pt 降順で順位付け。tier は 1〜4/5〜8/9位以下（種目プレフィックス）。
 * ダーツ/ビリヤードのランキングタブで使用（読み取り専用・管理者認証）。
 */

const PREFIX: Record<string, string> = { mahjong: "M", darts: "D", billiards: "B", poker: "P" };
const tierOf = (rank: number, prefix: string) => `${prefix}${rank <= 4 ? 1 : rank <= 8 ? 2 : 3}`;

export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const gameCategory = req.nextUrl.searchParams.get("gameCategory") || "";
  const seasonId = req.nextUrl.searchParams.get("seasonId") || "";
  if (!gameCategory || !seasonId) {
    return NextResponse.json({ error: "gameCategory と seasonId が必要です" }, { status: 400 });
  }
  const prefix = PREFIX[gameCategory] ?? "L";

  const snap = await getDb().collection("scores").where("seasonId", "==", seasonId).get();

  const agg = new Map<string, { totalPt: number; games: number; firsts: number }>();
  const names = new Map<string, { displayName: string; pictureUrl?: string }>();
  for (const d of snap.docs) {
    const x = d.data();
    if (x.gameCategory !== gameCategory) continue;
    const uid = x.lineUserId as string;
    const pt = Number(x.totalScore) || 0;
    const a = agg.get(uid) ?? { totalPt: 0, games: 0, firsts: 0 };
    a.totalPt += pt;
    a.games += 1;
    if (x.details && Number(x.details.dayRank) === 1) a.firsts += 1;
    agg.set(uid, a);
    if (x.displayName && !names.has(uid)) names.set(uid, { displayName: x.displayName, pictureUrl: x.pictureUrl });
  }

  // 埋め込み名が無い分だけ users を join。
  const uids = Array.from(agg.keys());
  const missing = uids.filter((u) => !names.has(u));
  for (let i = 0; i < missing.length; i += 30) {
    const batch = missing.slice(i, i + 30);
    if (batch.length === 0) continue;
    const us = await getDb().collection("users").where("lineUserId", "in", batch).get();
    us.docs.forEach((doc) => {
      const u = doc.data();
      names.set(u.lineUserId, { displayName: u.displayName || "ユーザー", pictureUrl: u.pictureUrl });
    });
  }

  const standings = uids
    .map((uid) => ({ uid, ...(agg.get(uid) as { totalPt: number; games: number; firsts: number }) }))
    .sort((a, b) => {
      if (b.totalPt !== a.totalPt) return b.totalPt - a.totalPt;
      if (b.firsts !== a.firsts) return b.firsts - a.firsts;
      if (b.games !== a.games) return b.games - a.games;
      return (names.get(a.uid)?.displayName ?? "").localeCompare(names.get(b.uid)?.displayName ?? "", "ja");
    })
    .map((s, i) => {
      const rank = i + 1;
      const p = names.get(s.uid);
      return {
        rank,
        lineUserId: s.uid,
        displayName: p?.displayName ?? "ユーザー",
        pictureUrl: p?.pictureUrl ?? "",
        totalPt: s.totalPt,
        games: s.games,
        firsts: s.firsts,
        tier: tierOf(rank, prefix),
      };
    });

  return NextResponse.json({ standings, seasonId, gameCategory });
}
