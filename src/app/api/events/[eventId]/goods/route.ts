import { NextRequest, NextResponse } from "next/server";
import { requireMember } from "@/lib/auth";
import { getDb } from "@/lib/firebaseAdmin";
import { resolveUserSummaries } from "@/lib/userSummaries";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
) {
  try {
    if (!await requireMember(req)) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401, headers });
    }
    const { eventId } = await params;
    const db = getDb();
    const ref = db.collection("events").doc(eventId);
    const doc = await ref.get();
    if (!doc.exists || doc.data()?.published !== true) {
      return NextResponse.json({ error: "イベントが見つかりません" }, { status: 404, headers });
    }
    const goods = await ref.collection("goods").orderBy("createdAt", "desc").get();
    const ids = goods.docs.map(good => good.data().userId);
    const users = await resolveUserSummaries(db, ids);
    return NextResponse.json({ users, count: users.length }, { headers });
  } catch (error) {
    console.error("[events/goods] Error:", error);
    return NextResponse.json({ error: "いいねした人の取得に失敗しました" }, { status: 500, headers });
  }
}
