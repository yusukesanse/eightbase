import { NextRequest, NextResponse } from "next/server";
import { requireProfileComplete } from "@/lib/auth";
import { getDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";

/**
 * POST /api/posts/:id/like
 * いいねをトグルする（押していなければ追加、押していれば削除）。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const lineUserId = await requireProfileComplete(req);
    if (!lineUserId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const { id: postId } = await params;
    const db = getDb();
    const postRef = db.collection("posts").doc(postId);
    const postDoc = await postRef.get();

    if (!postDoc.exists) {
      return NextResponse.json(
        { error: "投稿が見つかりません" },
        { status: 404 }
      );
    }

    const likes: string[] = postDoc.data()!.likes || [];
    const alreadyLiked = likes.includes(lineUserId);

    if (alreadyLiked) {
      await postRef.update({
        likes: FieldValue.arrayRemove(lineUserId),
      });
    } else {
      await postRef.update({
        likes: FieldValue.arrayUnion(lineUserId),
      });
    }

    return NextResponse.json({
      liked: !alreadyLiked,
      likeCount: alreadyLiked ? likes.length - 1 : likes.length + 1,
    });
  } catch (error) {
    console.error("[api/posts/[id]/like] error:", error);
    return NextResponse.json(
      { error: "処理に失敗しました" },
      { status: 500 }
    );
  }
}
