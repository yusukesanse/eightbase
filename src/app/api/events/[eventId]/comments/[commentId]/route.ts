import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireMember } from "@/lib/auth";
import { checkAdminAuth } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/events/[eventId]/comments/[commentId]
 * 権限方針: **投稿者本人**（自分のコメント）＋ **管理者**（モデレーション）が削除できる。
 * ハード削除（v1では論理削除・監査履歴は持たない。管理者削除はサーバーログに残す）。
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ eventId: string; commentId: string }> }
) {
  const { eventId, commentId } = await params;
  const db = getDb();
  const ref = db.collection("events").doc(eventId).collection("comments").doc(commentId);

  // 管理者はモデレーションとして任意のコメントを削除できる。
  const isAdmin = await checkAdminAuth(req);
  if (isAdmin) {
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ success: true, alreadyGone: true });
    await ref.delete();
    console.log(`[events/comments] admin(${isAdmin}) deleted comment ${eventId}/${commentId}`);
    return NextResponse.json({ success: true });
  }

  // 会員は自分のコメントのみ削除できる。
  const userId = await requireMember(req);
  if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ success: true, alreadyGone: true });
  if (snap.data()?.authorId !== userId) {
    return NextResponse.json({ error: "自分のコメントのみ削除できます" }, { status: 403 });
  }
  await ref.delete();
  return NextResponse.json({ success: true });
}
