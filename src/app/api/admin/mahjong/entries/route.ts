import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getActiveSeason } from "@/lib/mahjong";
import type { MahjongEntry } from "@/types";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/admin/mahjong/entries?eventDate=YYYY-MM-DD
 * 指定開催日の参加表明者一覧（管理者）
 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const eventDate = req.nextUrl.searchParams.get("eventDate");
    if (!eventDate || !DATE_RE.test(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }
    const season = await getActiveSeason();
    if (!season) return NextResponse.json({ entries: [], seasonId: null });

    const snap = await getDb()
      .collection("mahjongEntries")
      .where("seasonId", "==", season.seasonId)
      .get();

    const entries = snap.docs
      .map((d) => ({ ...(d.data() as MahjongEntry), entryId: d.id }))
      .filter((e) => e.eventDate === eventDate)
      .sort((a, b) => a.enteredAt.localeCompare(b.enteredAt));

    return NextResponse.json({ entries, seasonId: season.seasonId });
  } catch (error) {
    console.error("[admin/mahjong/entries] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

/**
 * POST /api/admin/mahjong/entries
 * 管理者が参加者を追加（運営・テスト用）
 * body: { eventDate: string, lineUserId: string }
 */
export async function POST(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json().catch(() => null);
    const eventDate: unknown = body?.eventDate;
    const lineUserId: unknown = body?.lineUserId;
    if (typeof eventDate !== "string" || !DATE_RE.test(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }
    if (typeof lineUserId !== "string" || !lineUserId) {
      return NextResponse.json({ error: "lineUserId が不正です" }, { status: 400 });
    }

    const season = await getActiveSeason();
    if (!season) {
      return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });
    }

    const db = getDb();
    const userDoc = await db.collection("users").doc(lineUserId).get();
    if (!userDoc.exists) {
      return NextResponse.json({ error: "ユーザーが存在しません" }, { status: 400 });
    }
    const u = userDoc.data() || {};

    const entryId = `${season.seasonId}_${eventDate}_${lineUserId}`;
    const entry: Omit<MahjongEntry, "entryId"> = {
      seasonId: season.seasonId,
      eventDate,
      lineUserId,
      displayName: u.displayName || "ユーザー",
      pictureUrl: u.pictureUrl || "",
      enteredAt: new Date().toISOString(),
    };
    await db.collection("mahjongEntries").doc(entryId).set(entry, { merge: true });
    return NextResponse.json({ entry: { ...entry, entryId } }, { status: 201 });
  } catch (error) {
    console.error("[admin/mahjong/entries] POST error:", error);
    return NextResponse.json({ error: "追加に失敗しました" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/mahjong/entries?eventDate=YYYY-MM-DD&lineUserId=xxx
 * 管理者が参加者を取り消す
 */
export async function DELETE(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const eventDate = req.nextUrl.searchParams.get("eventDate");
    const lineUserId = req.nextUrl.searchParams.get("lineUserId");
    if (!eventDate || !DATE_RE.test(eventDate) || !lineUserId) {
      return NextResponse.json({ error: "パラメータが不正です" }, { status: 400 });
    }
    const season = await getActiveSeason();
    if (!season) return NextResponse.json({ success: true });

    const entryId = `${season.seasonId}_${eventDate}_${lineUserId}`;
    await getDb().collection("mahjongEntries").doc(entryId).delete();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/mahjong/entries] DELETE error:", error);
    return NextResponse.json({ error: "取消に失敗しました" }, { status: 500 });
  }
}
