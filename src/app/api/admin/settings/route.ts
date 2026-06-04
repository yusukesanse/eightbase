import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getDb } from "@/lib/firebaseAdmin";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/settings
 * アプリ設定を取得
 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const doc = await db.collection("settings").doc("app").get();
  return NextResponse.json({ settings: doc.exists ? doc.data() : {} });
}

/**
 * PUT /api/admin/settings
 * アプリ設定を更新（マージ）
 * Body: { key: value, ... }
 */
export async function PUT(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  // 許可するフィールドのホワイトリスト
  const ALLOWED = ["gameCalendarId"];
  const updates: Record<string, unknown> = {};
  for (const key of ALLOWED) {
    if (key in body) updates[key] = body[key];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "更新するフィールドがありません" }, { status: 400 });
  }

  const db = getDb();
  await db.collection("settings").doc("app").set(
    { ...updates, updatedAt: new Date().toISOString() },
    { merge: true }
  );

  return NextResponse.json({ success: true });
}
