import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser, requireProfileComplete } from "@/lib/auth";
import { getDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";

/**
 * GET /api/posts
 * 掲示板の投稿一覧を返す（新しい順）。
 *
 * クエリパラメータ:
 *   type   - "offer" | "request" でフィルタ
 *   limit  - 取得件数（デフォルト 30）
 */
export async function GET(req: NextRequest) {
  try {
    const lineUserId = await requireActiveUser(req);
    if (!lineUserId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const typeFilter = searchParams.get("type") || "";
    const limit = Math.min(Number(searchParams.get("limit")) || 30, 100);

    const db = getDb();
    let query: FirebaseFirestore.Query = db
      .collection("posts")
      .orderBy("createdAt", "desc")
      .limit(limit);

    if (typeFilter === "offer" || typeFilter === "request") {
      query = query.where("type", "==", typeFilter);
    }

    const snap = await query.get();

    // 投稿者の LINE 友だち追加URL（memberProfile.lineUrl）を一括取得し、
    // 「LINEで連絡」で投稿者へ直接つなげられるようにする（最新値を都度参照）。
    const authorIds = Array.from(new Set(snap.docs.map((doc) => doc.data().authorId).filter(Boolean)));
    const lineUrlByAuthor: Record<string, string> = {};
    if (authorIds.length > 0) {
      const userRefs = authorIds.map((id: string) => db.collection("users").doc(id));
      const userDocs = await db.getAll(...userRefs);
      userDocs.forEach((u) => {
        if (u.exists) {
          lineUrlByAuthor[u.id] = u.data()?.memberProfile?.lineUrl || "";
        }
      });
    }

    const posts = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        postId: doc.id,
        authorId: d.authorId,
        authorName: d.authorName || "",
        authorPictureUrl: d.authorPictureUrl || "",
        authorLineUrl: lineUrlByAuthor[d.authorId] || "",
        type: d.type,
        content: d.content,
        tags: d.tags || [],
        likes: d.likes || [],
        commentCount: d.commentCount || 0,
        createdAt: d.createdAt,
      };
    });

    return NextResponse.json(posts);
  } catch (error) {
    console.error("[api/posts] GET error:", error);
    return NextResponse.json(
      { error: "投稿の取得に失敗しました" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/posts
 * 新規投稿を作成する。
 *
 * Body: { type: "offer" | "request", content: string, tags?: string[] }
 */
export async function POST(req: NextRequest) {
  try {
    const lineUserId = await requireProfileComplete(req);
    if (!lineUserId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const { type, content, tags } = await req.json();

    // バリデーション
    if (type !== "offer" && type !== "request") {
      return NextResponse.json(
        { error: "type は offer または request を指定してください" },
        { status: 400 }
      );
    }
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return NextResponse.json(
        { error: "内容を入力してください" },
        { status: 400 }
      );
    }
    if (content.trim().length > 500) {
      return NextResponse.json(
        { error: "投稿は500文字以内で入力してください" },
        { status: 400 }
      );
    }

    const db = getDb();

    // ユーザー情報を取得
    const userDoc = await db.collection("users").doc(lineUserId).get();
    const userData = userDoc.exists ? userDoc.data()! : {};

    const cleanTags = Array.isArray(tags)
      ? tags
          .filter((t: unknown): t is string => typeof t === "string")
          .map((t: string) => t.trim())
          .filter((t: string) => t.length > 0)
          .slice(0, 5)
      : [];

    const postRef = db.collection("posts").doc();
    const now = new Date().toISOString();

    await postRef.set({
      authorId: lineUserId,
      authorName: userData.displayName || userData.lineDisplayName || "",
      authorPictureUrl: userData.pictureUrl || "",
      type,
      content: content.trim(),
      tags: cleanTags,
      likes: [],
      commentCount: 0,
      createdAt: now,
    });

    return NextResponse.json({ success: true, postId: postRef.id });
  } catch (error) {
    console.error("[api/posts] POST error:", error);
    return NextResponse.json(
      { error: "投稿に失敗しました" },
      { status: 500 }
    );
  }
}
