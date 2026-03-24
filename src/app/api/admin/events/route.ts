import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth, validateFields, pickAllowedFields } from "@/lib/adminAuth";
import { FieldValue } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";

/* ───────── バリデーションルール ───────── */

const EVENT_VALIDATION = {
  title:       { type: "string" as const, minLength: 1, maxLength: 200 },
  category:    { type: "string" as const, minLength: 1, maxLength: 50 },
  description: { type: "string" as const, minLength: 1, maxLength: 5000 },
  startAt:     { type: "string" as const, maxLength: 50 },
  endAt:       { type: "string" as const, maxLength: 50 },
  location:    { type: "string" as const, minLength: 1, maxLength: 200 },
  imageUrl:    { type: "url" as const, maxLength: 2000 },
  published:   { type: "boolean" as const },
  scheduledAt: { type: "string" as const, maxLength: 50 },
};

const EVENT_UPDATE_FIELDS = [
  "title", "category", "description", "startAt", "endAt",
  "location", "imageUrl", "published", "scheduledAt",
];

/**
 * GET /api/admin/events
 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    const snap = await db
      .collection("events")
      .orderBy("startAt", "desc")
      .get();

    const events = snap.docs.map((doc) => ({
      eventId: doc.id,
      ...doc.data(),
      goodCount: doc.data().goodCount ?? 0,
    }));
    return NextResponse.json({ events });
  } catch (error) {
    console.error("[admin/events] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

/**
 * POST /api/admin/events
 */
export async function POST(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { title, category, description, startAt, endAt, location, imageUrl, published, scheduledAt } = body;

    if (!title || !category || !description || !startAt || !endAt || !location) {
      return NextResponse.json({ error: "必須フィールドが不足しています" }, { status: 400 });
    }

    // バリデーション
    const validationError = validateFields(body, EVENT_VALIDATION);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const db = getDb();
    const data: Record<string, unknown> = {
      title,
      category,
      description,
      startAt,
      endAt,
      location,
      published: published ?? false,
      goodCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (imageUrl) data.imageUrl = imageUrl;
    if (scheduledAt) data.scheduledAt = scheduledAt;

    const docRef = await db.collection("events").add(data);
    return NextResponse.json({ success: true, eventId: docRef.id });
  } catch (error) {
    console.error("[admin/events] POST error:", error);
    return NextResponse.json({ error: "作成に失敗しました" }, { status: 500 });
  }
}

/**
 * PUT /api/admin/events
 * ホワイトリストで許可されたフィールドのみ更新可能
 */
export async function PUT(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { eventId } = body;

    if (!eventId || typeof eventId !== "string") {
      return NextResponse.json({ error: "eventId は必須です" }, { status: 400 });
    }

    // ホワイトリストフィルタ
    const fields = pickAllowedFields(body, EVENT_UPDATE_FIELDS);

    // バリデーション
    const validationError = validateFields(fields, EVENT_VALIDATION);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const db = getDb();
    const docRef = db.collection("events").doc(eventId);
    const doc = await docRef.get();
    if (!doc.exists) {
      return NextResponse.json({ error: "イベントが見つかりません" }, { status: 404 });
    }

    // scheduledAt が空文字なら削除
    if (fields.scheduledAt === "" || fields.scheduledAt === null) {
      fields.scheduledAt = FieldValue.delete();
    }

    await docRef.update({ ...fields, updatedAt: new Date().toISOString() });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/events] PUT error:", error);
    return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/events
 */
export async function DELETE(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { eventId } = await req.json();
    if (!eventId || typeof eventId !== "string") {
      return NextResponse.json({ error: "eventId は必須です" }, { status: 400 });
    }

    const db = getDb();
    await db.collection("events").doc(eventId).delete();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/events] DELETE error:", error);
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }
}
