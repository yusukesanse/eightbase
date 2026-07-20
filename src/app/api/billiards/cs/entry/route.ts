import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { resolveBilliardsSeasonRank, BILLIARDS_CS_NON_LEAGUE_RANK } from "@/lib/billiardsCsServer";
import { BILLIARDS_CS_SEED_COUNT } from "@/lib/billiardsCs";
import type { BilliardsCsEvent, BilliardsCsEntrant } from "@/types/billiards";

export const dynamic = "force-dynamic";

/** アクティブシーズンの最新CS doc の ref を返す（無ければ null）。 */
async function resolveCurrentCs(
  db: FirebaseFirestore.Firestore,
  seasonId: string
): Promise<{ ref: FirebaseFirestore.DocumentReference } | null> {
  const snap = await db.collection("billiardsCsEvents").where("seasonId", "==", seasonId).get();
  if (snap.empty) return null;
  const newest = snap.docs.sort(
    (a, b) => (b.data().createdAt as string).localeCompare(a.data().createdAt as string)
  )[0];
  return { ref: newest.ref };
}

/** POST /api/billiards/cs/entry — CSに自己エントリー（setup中のみ・冪等・誰でも参加可）。 */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireGameUser(req);
    if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

    const season = await getActiveSeason("billiards");
    if (!season) return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });

    const db = getDb();
    const cs = await resolveCurrentCs(db, season.seasonId);
    if (!cs) return NextResponse.json({ error: "CSがありません" }, { status: 404 });

    const rank = await resolveBilliardsSeasonRank(season.seasonId, userId);
    const u = (await db.collection("users").doc(userId).get()).data() || {};

    const result = await db.runTransaction(async (tx) => {
      const doc = await tx.get(cs.ref);
      if (!doc.exists) return { status: 404 as const, error: "CSが見つかりません" };
      const ev = doc.data() as BilliardsCsEvent;
      if (ev.status !== "setup") return { status: 409 as const, error: "エントリーの受付は終了しました" };
      const entrants = ev.entrants ?? [];
      if (entrants.some((e) => e.lineUserId === userId)) {
        return { status: 200 as const, entered: true, count: entrants.length }; // 冪等
      }
      const entrant: BilliardsCsEntrant = {
        lineUserId: userId,
        displayName: u.displayName || "ユーザー",
        pictureUrl: u.pictureUrl || "",
        rank,
        seed: rank <= BILLIARDS_CS_SEED_COUNT && rank !== BILLIARDS_CS_NON_LEAGUE_RANK,
      };
      const next = [...entrants, entrant];
      tx.update(cs.ref, { entrants: next, updatedAt: new Date().toISOString() });
      return { status: 200 as const, entered: true, count: next.length };
    });

    if (result.status !== 200) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, entered: result.entered, count: result.count });
  } catch (error) {
    console.error("[billiards/cs/entry] POST error:", error);
    return NextResponse.json({ error: "エントリーに失敗しました" }, { status: 500 });
  }
}

/** DELETE /api/billiards/cs/entry — エントリー取消（setup中のみ・冪等）。 */
export async function DELETE(req: NextRequest) {
  try {
    const userId = await requireGameUser(req);
    if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

    const season = await getActiveSeason("billiards");
    if (!season) return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });

    const db = getDb();
    const cs = await resolveCurrentCs(db, season.seasonId);
    if (!cs) return NextResponse.json({ error: "CSがありません" }, { status: 404 });

    const result = await db.runTransaction(async (tx) => {
      const doc = await tx.get(cs.ref);
      if (!doc.exists) return { status: 404 as const, error: "CSが見つかりません" };
      const ev = doc.data() as BilliardsCsEvent;
      if (ev.status !== "setup") return { status: 409 as const, error: "エントリーの受付は終了しました" };
      const entrants = ev.entrants ?? [];
      const next = entrants.filter((e) => e.lineUserId !== userId);
      if (next.length !== entrants.length) {
        tx.update(cs.ref, { entrants: next, updatedAt: new Date().toISOString() });
      }
      return { status: 200 as const, entered: false, count: next.length };
    });

    if (result.status !== 200) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, entered: result.entered, count: result.count });
  } catch (error) {
    console.error("[billiards/cs/entry] DELETE error:", error);
    return NextResponse.json({ error: "取消に失敗しました" }, { status: 500 });
  }
}
