import { NextRequest, NextResponse } from "next/server";
import { getDb, getAllActiveLineUserIds } from "@/lib/firebaseAdmin";
import { checkAdminAuth, validateFields, pickAllowedFields } from "@/lib/adminAuth";
import { broadcastContentPublished } from "@/lib/line";
import { FieldValue } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";

/* ───────── バリデーションルール ───────── */

const NEWS_VALIDATION = {
  title:       { type: "string" as const, minLength: 1, maxLength: 200 },
  body:        { type: "string" as const, minLength: 1, maxLength: 10000 },
  category:    { type: "string" as const, minLength: 1, maxLength: 50 },
  imageUrl:    { type: "url" as const, maxLength: 2000 },
  priority:    { type: "string" as const, minLength: 1, maxLength: 10 },
  published:   { type: "boolean" as const },
  publishedAt: { type: "string" as const, maxLength: 50 },
  scheduledAt: { type: "string" as const, maxLength: 50 },
};

const NEWS_UPDATE_FIELDS = [
  "title", "body", "category", "imageUrl", "priority",
  "published", "publishedAt", "scheduledAt",
];

/**
 * GET /api/admin/news
 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
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
 */
export async function POST(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const reqBody = await req.json();
    const { title, body, category, imageUrl, published, scheduledAt, priority } = reqBody;
    const publishedAt = reqBody.publishedAt || new Date().toISOString();

    if (!title || !body || !category) {
      return NextResponse.json({ error: "必須フィールドが不足しています" }, { status: 400 });
    }

    const validationError = validateFields(reqBody, NEWS_VALIDATION);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const db = getDb();
    const data: Record<string, unknown> = {
      title,
      body,
      category,
      publishedAt,
      priority: priority ?? "normal",
      published: published ?? false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (imageUrl) data.imageUrl = imageUrl;
    if (scheduledAt) data.scheduledAt = scheduledAt;

    const docRef = await db.collection("news").add(data);

    if (data.published === true) {
      try {
        const userIds = await getAllActiveLineUserIds();
        await broadcastContentPublished(userIds, "news", title);
      } catch (err) {
        console.error("[admin/news] broadcast failed:", err);
      }
    }

    return NextResponse.json({ success: true, newsId: docRef.id });
  } catch (error) {
    console.error("[admin/news] POST error:", error);
    return NextResponse.json({ error: "作成に失敗しました" }, { status: 500 });
  }
}

/**
 * PUT /api/admin/news
 */
export async function PUT(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { newsId } = body;

    if (!newsId || typeof newsId !== "string") {
      return NextResponse.json({ error: "newsId は必須です" }, { status: 400 });
    }

    const fields = pickAllowedFields(body, NEWS_UPDATE_FIELDS);

    const validationError = validateFields(fields, NEWS_VALIDATION);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
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

    const wasPublished = doc.data()?.published === true;
    await docRef.update({ ...fields, updatedAt: new Date().toISOString() });

    if (!wasPublished && fields.published === true) {
      try {
        const title = fields.title || doc.data()?.title || "新しいニュース";
        const userIds = await getAllActiveLineUserIds();
        await broadcastContentPublished(userIds, "news", title);
      } catch (err) {
        console.error("[admin/news] broadcast failed:", err);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/news] PUT error:", error);
    return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/news
 */
export async function DELETE(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { newsId } = await req.json();
    if (!newsId || typeof newsId !== "string") {
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
