import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { FieldValue } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/news
 * 管理者がニュース一覧を取得（未公開含む）
 */
export async function GET(req: NextRequest) {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    const snap = await db
      .collection("news")
      .orderBy("publishedAt", "desc")
      .get();

    const news = snap.docs.map((doc) => ({ newsId: doc.id, ...doc.data() }));
    return NextResponse.json({ news });
  } catch (error) {
    console.error("[admin/news] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

/**
 * POST /api/admin/news
 * ニュースを作成する
 * Body: { title, body, category, publishedAt?, imageUrl?, published, scheduledAt? }
 */
export async function POST(req: NextRequest) {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const reqBody = await req.json();
    const { title, body, category, imageUrl, published, scheduledAt } = reqBody;
    const publishedAt = reqBody.publishedAt || new Date().toISOString();

    if (!title || !body || !category) {
      return NextResponse.json({ error: "必須フィールドが不足しています" }, { status: 400 });
    }

    const db = getDb();
    const data: Record<string, unknown> = {
      title,
      body,
      category,
      publishedAt,
      published: published ?? false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (imageUrl) data.imageUrl = imageUrl;
    if (scheduledAt) data.scheduledAt = scheduledAt;

    const docRef = await db.collection("news").add(data);
    return NextResponse.json({ success: true, newsId: docRef.id });
  } catch (error) {
    console.error("[admin/news] POST error:", error);
    return NextResponse.json({ error: "作成に失敗しました" }, { status: 500 });
  }
}

/**
 * PUT /api/admin/news
 * ニュースを更新する
 * Body: { newsId, ...fields }
 */
export async function PUT(req: NextRequest) {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { newsId, ...fields } = body;

    if (!newsId) {
      return NextResponse.json({ error: "newsId は必須です" }, { status: 400 });
    }

    const db = getDb();
    const docRef = db.collection("news").doc(newsId);
    const doc = await docRef.get();
    if (!doc.exists) {
      return NextResponse.json({ error: "ニュースが見つかりません" }, { status: 404 });
    }

    if (fields.scheduledAt === "" || fields.scheduledAt === null) {
      fields.scheduledAt = FieldValue.delete();
    }

    await docRef.update({ ...fields, updatedAt: new Date().toISOString() });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/news] PUT error:", error);
    return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/news
 * ニュースを削除する
 * Body: { newsId }
 */
export async function DELETE(req: NextRequest) {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { newsId } = await req.json();
    if (!newsId) {
      return NextResponse.json({ error: "newsId は必須です" }, { status: 400 });
    }

    const db = getDb();
    await db.collection("news").doc(newsId).delete();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/news] DELETE error:", error);
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }
}
