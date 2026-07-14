import { NextRequest, NextResponse } from "next/server";
import { requireGameUser } from "@/lib/auth";
import { usesUrlInvite } from "@/lib/roles";
import { getDb } from "@/lib/firebaseAdmin";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/guest-name
 * ゲストが氏名確認画面で表示名を確定/修正する。
 * Body: { displayName: string }
 *
 * - ログイン中のゲスト本人のみ（role=guest）。会員は対象外（会員はプロフィール3ステップを使う）。
 * - authorizedUsers / users の displayName を更新し、guestOnboarded=true を立てる。
 */
export async function POST(req: NextRequest) {
  const lineUserId = await requireGameUser(req);
  if (!lineUserId) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { displayName } = await req.json().catch(() => ({}));
  if (!displayName || typeof displayName !== "string" || !displayName.trim()) {
    return NextResponse.json({ error: "お名前を入力してください" }, { status: 400 });
  }
  const trimmed = displayName.trim().slice(0, 50);

  const db = getDb();
  const snap = await db
    .collection("authorizedUsers")
    .where("lineUserId", "==", lineUserId)
    .where("active", "==", true)
    .limit(1)
    .get();
  if (snap.empty) {
    return NextResponse.json({ error: "ユーザーが見つかりません" }, { status: 404 });
  }
  const userRef = snap.docs[0].ref;
  const data = snap.docs[0].data();
  // ゲスト/エイト社員（URL招待でオンボードする身分）のみ。会員は別フロー。
  if (!usesUrlInvite(data.role)) {
    return NextResponse.json({ error: "この操作はゲスト/エイト社員のみ利用できます" }, { status: 403 });
  }

  const nowIso = new Date().toISOString();
  await userRef.update({ displayName: trimmed, guestOnboarded: true, updatedAt: nowIso });
  await db
    .collection("users")
    .doc(lineUserId)
    .set({ displayName: trimmed, updatedAt: nowIso }, { merge: true });

  return NextResponse.json({ success: true, displayName: trimmed });
}
