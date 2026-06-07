import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { getDb } from "@/lib/firebaseAdmin";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/posts/[id]
 * 自分の投稿のみ削除可能
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getSessionUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const { id: postId } = await params;
    const db = getDb();
    const postRef = db.collection("posts").doc(postId);
    const postDoc = await postRef.get();

    if (!postDoc.exists) {
      return NextResponse.json({ error: "投稿が見つかりません" }, { status: 404 });
    }

    // 自分の投稿かチェック
    if (postDoc.data()?.authorId !== userId) {
      return NextResponse.json({ error: "自分の投稿のみ削除できます" }, { status: 403 });
    }

    // コメントサブコレクションも削除
    const commentsSnap = await postRef.collection("comments").get();
    const batch = db.batch();
    commentsSnap.docs.forEach((doc) => batch.delete(doc.ref));
    batch.delete(postRef);
    await batch.commit();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[posts/delete] Error:", error);
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }
}
