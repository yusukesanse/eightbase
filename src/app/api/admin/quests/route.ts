import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { FieldValue } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/quests
 * 管理者がクエスト一覧を取得（未公開含む）
 */
export async function GET(req: NextRequest) {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    const snap = await db.collection("quests").orderBy("createdAt", "desc").get();
    const quests = snap.docs.map((doc) => ({ questId: doc.id, ...doc.data() }));
    return NextResponse.json({ quests });
  } catch (error) {
    console.error("[admin/quests] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

/**
 * POST /api/admin/quests
 * クエストを作成する
 * Body: { title, description, requiredCount, rewardPoints, category, imageUrl?, published, scheduledAt? }
 */
export async function POST(req: NextRequest) {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { title, description, requiredCount, rewardPoints, category, imageUrl, published, scheduledAt } = body;

    if (!title || !description || requiredCount === undefined || rewardPoints === undefined || !category) {
      return NextResponse.json({ error: "必須フィールドが不足しています" }, { status: 400 });
    }

    const db = getDb();
    const data: Record<string, unknown> = {
      title,
      description,
      requiredCount: Number(requiredCount),
      rewardPoints: Number(rewardPoints),
      category,
      published: published ?? false,
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
 * クエストを更新する
 * Body: { questId, ...fields }
 */
export async function PUT(req: NextRequest) {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { questId, ...fields } = body;

    if (!questId) {
      return NextResponse.json({ error: "questId は必須です" }, { status: 400 });
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
 * クエストを削除する
 * Body: { questId }
 */
export async function DELETE(req: NextRequest) {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { questId } = await req.json();
    if (!questId) {
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
