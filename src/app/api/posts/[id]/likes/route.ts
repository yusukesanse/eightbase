import { NextRequest, NextResponse } from "next/server";
import { requireMember } from "@/lib/auth";
import { getDb } from "@/lib/firebaseAdmin";
import { resolveUserSummaries } from "@/lib/userSummaries";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (!await requireMember(req)) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401, headers });
    }
    const { id } = await params;
    const db = getDb();
    const ref = db.collection("posts").doc(id);
    const doc = await ref.get();
    if (!doc.exists) {
      return NextResponse.json({ error: "投稿が見つかりません" }, { status: 404, headers });
    }
    const raw = doc.data()?.likes;
    const ids = Array.isArray(raw) ? raw : [];
    const users = await resolveUserSummaries(db, [...ids].reverse());
    return NextResponse.json({ users, count: users.length }, { headers });
  } catch (error) {
    console.error("[posts/likes] Error:", error);
    return NextResponse.json({ error: "いいねした人の取得に失敗しました" }, { status: 500, headers });
  }
}
