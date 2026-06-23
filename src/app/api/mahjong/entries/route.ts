import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireActiveUser, requireProfileComplete } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { isDummyDataEnabled } from "@/lib/env";
import { dummyEntries } from "@/lib/previewDummy";
import type { MahjongEntry } from "@/types";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/mahjong/entries?eventDate=YYYY-MM-DD
 * 指定開催日の参加表明者一覧（アクティブシーズン）
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireActiveUser(req);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    // プレビューモード: ダミー参加表明を返す（本番には出ない / eventDate不問）
    if (isDummyDataEnabled()) {
      return NextResponse.json(dummyEntries);
    }

    const eventDate = req.nextUrl.searchParams.get("eventDate");
    if (!eventDate || !DATE_RE.test(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }

    const season = await getActiveSeason();
    if (!season) return NextResponse.json({ entries: [], entered: false });

    const snap = await getDb()
      .collection("mahjongEntries")
      .where("seasonId", "==", season.seasonId)
      .get();

    const entries = snap.docs
      .map((d) => ({ ...(d.data() as MahjongEntry), entryId: d.id }))
      .filter((e) => e.eventDate === eventDate)
      .sort((a, b) => a.enteredAt.localeCompare(b.enteredAt));

    return NextResponse.json({
      entries,
      entered: entries.some((e) => e.lineUserId === userId),
    });
  } catch (error) {
    console.error("[mahjong/entries] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

/**
 * POST /api/mahjong/entries
 * 開催日への参加表明（自分）
 * body: { eventDate: string }
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireProfileComplete(req);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const eventDate: unknown = body?.eventDate;
    if (typeof eventDate !== "string" || !DATE_RE.test(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }

    const season = await getActiveSeason();
    if (!season) {
      return NextResponse.json(
        { error: "アクティブなシーズンがありません" },
        { status: 400 }
      );
    }

    const db = getDb();
    // 決定的な ID で重複表明を防ぐ
    const entryId = `${season.seasonId}_${eventDate}_${userId}`;
    const ref = db.collection("mahjongEntries").doc(entryId);

    const userDoc = await db.collection("users").doc(userId).get();
    const u = userDoc.data() || {};

    const entry: Omit<MahjongEntry, "entryId"> = {
      seasonId: season.seasonId,
      eventDate,
      lineUserId: userId,
      displayName: u.displayName || "ユーザー",
      pictureUrl: u.pictureUrl || "",
      enteredAt: new Date().toISOString(),
    };

    await ref.set(entry, { merge: true });
    return NextResponse.json({ entry: { ...entry, entryId } }, { status: 201 });
  } catch (error) {
    console.error("[mahjong/entries] POST error:", error);
    return NextResponse.json({ error: "参加表明に失敗しました" }, { status: 500 });
  }
}

/**
 * DELETE /api/mahjong/entries?eventDate=YYYY-MM-DD
 * 参加表明の取消（自分）
 */
export async function DELETE(req: NextRequest) {
  try {
    const userId = await requireActiveUser(req);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const eventDate = req.nextUrl.searchParams.get("eventDate");
    if (!eventDate || !DATE_RE.test(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }

    const season = await getActiveSeason();
    if (!season) return NextResponse.json({ success: true });

    const entryId = `${season.seasonId}_${eventDate}_${userId}`;
    await getDb().collection("mahjongEntries").doc(entryId).delete();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[mahjong/entries] DELETE error:", error);
    return NextResponse.json({ error: "取消に失敗しました" }, { status: 500 });
  }
}
