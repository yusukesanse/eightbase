import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";

export const dynamic = "force-dynamic";

/**
 * GET /api/quests/[questId]/good
 * グッド数と、リクエストしたユーザーがグッド済みかを返す
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { questId: string } }
) {
  const { questId } = params;
  const userId = req.headers.get("x-line-user-id") ?? "";

  const db = getDb();
  const goodsRef = db.collection("quests").doc(questId).collection("goods");
  const snap = await goodsRef.get();

  const count = snap.size;
  const liked = userId ? snap.docs.some((d) => d.id === userId) : false;

  return NextResponse.json({ questId, count, liked });
}

/**
 * POST /api/quests/[questId]/good
 * グッドのトグル（追加 or 削除）
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { questId: string } }
) {
  const { questId } = params;
  const userId = req.headers.get("x-line-user-id");
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const goodRef = db
    .collection("quests")
    .doc(questId)
    .collection("goods")
    .doc(userId);

  const existing = await goodRef.get();

  if (existing.exists) {
    // すでにグッド済み → 削除
    await goodRef.delete();
    return NextResponse.json({ questId, liked: false });
  } else {
    // グッド追加
    await goodRef.set({ createdAt: new Date().toISOString() });
    return NextResponse.json({ questId, liked: true });
  }
}
