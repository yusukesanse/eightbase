import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { getDb } from "@/lib/firebaseAdmin";

export const dynamic = "force-dynamic";

/**
 * GET /api/posts/[id]
 * 投稿を単体で取得する。詳細画面が一覧（最新30件）から探さなくて済むように用意。
 */
export async function GET(
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
    const postDoc = await db.collection("posts").doc(postId).get();

    if (!postDoc.exists) {
      return NextResponse.json({ error: "投稿が見つかりません" }, { status: 404 });
    }

    const d = postDoc.data()!;
    return NextResponse.json({
      postId: postDoc.id,
      authorId: d.authorId,
      authorName: d.authorName || "",
      authorPictureUrl: d.authorPictureUrl || "",
      type: d.type,
      content: d.content,
      tags: d.tags || [],
      likes: d.likes || [],
      commentCount: d.commentCount || 0,
      createdAt: d.createdAt,
    });
  } catch (error) {
    console.error("[posts/get] Error:", error);
    return NextResponse.json({ error: "投稿の取得に失敗しました" }, { status: 500 });
  }
}

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
