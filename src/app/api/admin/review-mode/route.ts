import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getDb } from "@/lib/firebaseAdmin";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/review-mode
 * 審査モードの現在の状態を取得
 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const doc = await db.collection("settings").doc("app").get();
  const reviewMode = doc.exists ? doc.data()?.reviewMode === true : false;

  return NextResponse.json({ reviewMode });
}

/**
 * PUT /api/admin/review-mode
 * 審査モードのオン/オフを切り替え
 */
export async function PUT(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { reviewMode } = await req.json();

  if (typeof reviewMode !== "boolean") {
    return NextResponse.json({ error: "reviewMode must be boolean" }, { status: 400 });
  }

  const db = getDb();
  await db.collection("settings").doc("app").set(
    { reviewMode, updatedAt: new Date().toISOString() },
    { merge: true }
  );

  console.log(`[review-mode] set to ${reviewMode}`);

  return NextResponse.json({ success: true, reviewMode });
}
