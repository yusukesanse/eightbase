import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/admin/mahjong/leagues/[assignmentId]
 * 確定したリーグ編成スナップショットを取り消す（管理者）
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { assignmentId } = await params;
    const ref = getDb().collection("mahjongLeagueAssignments").doc(assignmentId);
    const doc = await ref.get();
    if (!doc.exists) {
      return NextResponse.json({ error: "編成が見つかりません" }, { status: 404 });
    }
    await ref.delete();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/mahjong/leagues/:id] DELETE error:", error);
    return NextResponse.json({ error: "取消に失敗しました" }, { status: 500 });
  }
}
