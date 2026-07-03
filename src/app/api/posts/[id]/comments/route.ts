import { NextRequest, NextResponse } from "next/server";
import { requireMember, requireMemberProfileComplete } from "@/lib/auth";
import { getDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { sendCommentNotification } from "@/lib/line";

export const dynamic = "force-dynamic";

/**
 * GET /api/posts/:id/comments
 * 投稿に対するコメント一覧を取得する。
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const lineUserId = await requireMember(req);
    if (!lineUserId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const { id: postId } = await params;
    const db = getDb();

    const snap = await db
      .collection("posts")
      .doc(postId)
      .collection("comments")
      .orderBy("createdAt", "asc")
      .limit(100)
      .get();

    const comments = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        commentId: doc.id,
        authorId: d.authorId,
        authorName: d.authorName || "",
        authorPictureUrl: d.authorPictureUrl || "",
        content: d.content,
        createdAt: d.createdAt,
      };
    });

    return NextResponse.json(comments);
  } catch (error) {
    console.error("[api/posts/[id]/comments] GET error:", error);
    return NextResponse.json(
      { error: "コメントの取得に失敗しました" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/posts/:id/comments
 * 投稿にコメントを追加する。
 *
 * Body: { content: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const lineUserId = await requireMemberProfileComplete(req);
    if (!lineUserId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const { id: postId } = await params;
    const { content } = await req.json();

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return NextResponse.json(
        { error: "コメントを入力してください" },
        { status: 400 }
      );
    }
    if (content.trim().length > 200) {
      return NextResponse.json(
        { error: "コメントは200文字以内で入力してください" },
        { status: 400 }
      );
    }

    const db = getDb();

    // 投稿の存在確認
    const postRef = db.collection("posts").doc(postId);
    const postDoc = await postRef.get();
    if (!postDoc.exists) {
      return NextResponse.json(
        { error: "投稿が見つかりません" },
        { status: 404 }
      );
    }

    // ユーザー情報取得
    const userDoc = await db.collection("users").doc(lineUserId).get();
    const userData = userDoc.exists ? userDoc.data()! : {};

    const now = new Date().toISOString();
    const commentRef = postRef.collection("comments").doc();

    await commentRef.set({
      authorId: lineUserId,
      authorName: userData.displayName || userData.lineDisplayName || "",
      authorPictureUrl: userData.pictureUrl || "",
      content: content.trim(),
      createdAt: now,
    });

    // 親投稿の commentCount をインクリメント
    await postRef.update({
      commentCount: FieldValue.increment(1),
    });

    // 投稿者にLINE通知（自分自身へのコメントは除外）
    const postData = postDoc.data()!;
    const postAuthorId = postData.authorId as string;
    if (postAuthorId && postAuthorId !== lineUserId) {
      try {
        const commenterName = (userData.displayName || userData.lineDisplayName || "メンバー") as string;
        const postContent = (postData.content || "") as string;
        await sendCommentNotification(postAuthorId, {
          commenterName,
          postContent,
          postId,
        });
      } catch (err) {
        // 通知失敗してもコメント自体は成功させる
        console.error("[api/posts/[id]/comments] LINE notification failed:", err);
      }
    }

    return NextResponse.json({
      success: true,
      commentId: commentRef.id,
    });
  } catch (error) {
    console.error("[api/posts/[id]/comments] POST error:", error);
    return NextResponse.json(
      { error: "コメントの投稿に失敗しました" },
      { status: 500 }
    );
  }
}
