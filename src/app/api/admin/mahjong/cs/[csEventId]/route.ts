import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import type { MahjongCsEvent } from "@/types";

export const dynamic = "force-dynamic";

/** GET /api/admin/mahjong/cs/[csEventId] — CSイベント詳細 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ csEventId: string }> }
) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { csEventId } = await params;
    const doc = await getDb().collection("mahjongCsEvents").doc(csEventId).get();
    if (!doc.exists) {
      return NextResponse.json({ error: "CSが見つかりません" }, { status: 404 });
    }
    return NextResponse.json({ event: { ...(doc.data() as MahjongCsEvent), csEventId: doc.id } });
  } catch (error) {
    console.error("[admin/mahjong/cs/:id] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/mahjong/cs/[csEventId]
 * 参戦者の追加・除外（setup中のみ）
 * body: { addEntrant?: {...}, removeUserId?: string }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ csEventId: string }> }
) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { csEventId } = await params;
    const body = await req.json().catch(() => null);
    const db = getDb();
    const ref = db.collection("mahjongCsEvents").doc(csEventId);

    // 参戦者リストは利用者の自己エントリー（/api/mahjong/cs/entry）とも並行更新される。
    // read-modify-write の取りこぼし（lost-update）を防ぐため transaction で更新する。
    const result = await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) return { status: 404 as const, error: "CSが見つかりません" };
      const event = doc.data() as MahjongCsEvent;
      if (event.status !== "setup") {
        return { status: 400 as const, error: "開始後は参戦者を変更できません" };
      }

      let entrants = [...event.entrants];
      if (body?.removeUserId) {
        entrants = entrants.filter((e) => e.lineUserId !== body.removeUserId);
      }
      if (body?.addEntrant?.lineUserId) {
        const a = body.addEntrant;
        if (!entrants.some((e) => e.lineUserId === a.lineUserId)) {
          entrants.push({
            lineUserId: a.lineUserId,
            displayName: a.displayName || "ユーザー",
            pictureUrl: a.pictureUrl || "",
            tier: a.tier || "M3",
            rank: typeof a.rank === "number" ? a.rank : 999,
            seed: a.tier === "M1",
          });
        }
      }

      tx.update(ref, { entrants, updatedAt: new Date().toISOString() });
      return { status: 200 as const, entrants };
    });

    if (result.status !== 200) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, entrants: result.entrants });
  } catch (error) {
    console.error("[admin/mahjong/cs/:id] PATCH error:", error);
    return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
  }
}

/** DELETE /api/admin/mahjong/cs/[csEventId] — CS削除 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ csEventId: string }> }
) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { csEventId } = await params;
    await getDb().collection("mahjongCsEvents").doc(csEventId).delete();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/mahjong/cs/:id] DELETE error:", error);
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }
}
