import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth, validateFields, pickAllowedFields } from "@/lib/adminAuth";
import { FieldValue } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";

/* ───────── バリデーションルール ───────── */

const QUEST_VALIDATION = {
  title:         { type: "string" as const, minLength: 1, maxLength: 200 },
  description:   { type: "string" as const, minLength: 1, maxLength: 5000 },
  requiredCount: { type: "number" as const, min: 1, max: 100000 },
  rewardPoints:  { type: "number" as const, min: 0, max: 1000000 },
  category:      { type: "string" as const, minLength: 1, maxLength: 50 },
  imageUrl:      { type: "url" as const, maxLength: 2000 },
  published:     { type: "boolean" as const },
  scheduledAt:   { type: "string" as const, maxLength: 50 },
};

const QUEST_UPDATE_FIELDS = [
  "title", "description", "requiredCount", "rewardPoints",
  "category", "imageUrl", "published", "scheduledAt",
];

/**
 * GET /api/admin/quests
 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    const snap = await db.collection("quests").orderBy("createdAt", "desc").get();
    const quests = snap.docs.map((doc) => ({
      questId: doc.id,
      ...doc.data(),
      goodCount: doc.data().goodCount ?? 0,
    }));
    return NextResponse.json({ quests });
  } catch (error) {
    console.error("[admin/quests] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

/**
 * POST /api/admin/quests
 */
export async function POST(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { title, description, requiredCount, rewardPoints, category, imageUrl, published, scheduledAt } = body;

    if (!title || !description || requiredCount === undefined || rewardPoints === undefined || !category) {
      return NextResponse.json({ error: "必須フィールドが不足しています" }, { status: 400 });
    }

    const validationError = validateFields(body, QUEST_VALIDATION);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const db = getDb();
    const data: Record<string, unknown> = {
      title,
      description,
      requiredCount: Number(requiredCount),
      rewardPoints: Number(rewardPoints),
      category,
      published: published ?? false,
      goodCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (imageUrl) data.imageUrl = imageUrl;
    if (scheduledAt) data.scheduledAt = scheduledAt;

    const docRef = await db.collection("quests").add(data);
    return NextResponse.json({ success: true, questId: docRef.id });
  } catch (error) {
    console.error("[admin/quests] POST error:", error);
    return NextResponse.json({ error: "作成に失敗しました" }, { status: 500 });
  }
}

/**
 * PUT /api/admin/quests
 */
export async function PUT(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { questId } = body;

    if (!questId || typeof questId !== "string") {
      return NextResponse.json({ error: "questId は必須です" }, { status: 400 });
    }

    const fields = pickAllowedFields(body, QUEST_UPDATE_FIELDS);

    const validationError = validateFields(fields, QUEST_VALIDATION);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const db = getDb();
    const docRef = db.collection("quests").doc(questId);
    const doc = await docRef.get();
    if (!doc.exists) {
      return NextResponse.json({ error: "クエストが見つかりません" }, { status: 404 });
    }

    if (fields.scheduledAt === "" || fields.scheduledAt === null) {
      fields.scheduledAt = FieldValue.delete();
    }
    if (fields.requiredCount !== undefined) fields.requiredCount = Number(fields.requiredCount);
    if (fields.rewardPoints !== undefined) fields.rewardPoints = Number(fields.rewardPoints);

    await docRef.update({ ...fields, updatedAt: new Date().toISOString() });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/quests] PUT error:", error);
    return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/quests
 */
export async function DELETE(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { questId } = await req.json();
    if (!questId || typeof questId !== "string") {
      return NextResponse.json({ error: "questId は必須です" }, { status: 400 });
    }

    const db = getDb();
    await db.collection("quests").doc(questId).delete();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/quests] DELETE error:", error);
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }
}
