import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getActiveSeason } from "@/lib/mahjong";
import { MAHJONG_SCHEDULE_TEMPLATE } from "@/types";
import type { MahjongScheduleEntry, MahjongScheduleType } from "@/types";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/** GET /api/admin/mahjong/schedule?seasonId= — 日程一覧（日付順） */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    let seasonId = req.nextUrl.searchParams.get("seasonId");
    if (!seasonId) {
      const season = await getActiveSeason();
      if (!season) return NextResponse.json({ schedule: [], seasonId: null });
      seasonId = season.seasonId;
    }
    const snap = await getDb()
      .collection("mahjongSchedule")
      .where("seasonId", "==", seasonId)
      .get();
    const schedule = snap.docs
      .map((d) => ({ ...(d.data() as MahjongScheduleEntry), scheduleId: d.id }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return NextResponse.json({ schedule, seasonId });
  } catch (error) {
    console.error("[admin/mahjong/schedule] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

/**
 * POST /api/admin/mahjong/schedule
 * 日程を追加。body のいずれか:
 *   - { template: true } 資料の年間日程を一括登録
 *   - { date, startTime, endTime, type } 1件追加
 */
export async function POST(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const season = await getActiveSeason();
    if (!season) {
      return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });
    }
    const db = getDb();
    const body = await req.json().catch(() => null);
    const now = new Date().toISOString();

    if (body?.template === true) {
      // 既存の日付と重複しないものだけ追加
      const existing = await db
        .collection("mahjongSchedule")
        .where("seasonId", "==", season.seasonId)
        .get();
      const existingDates = new Set(
        existing.docs.map((d) => (d.data() as MahjongScheduleEntry).date)
      );
      const batch = db.batch();
      let added = 0;
      for (const t of MAHJONG_SCHEDULE_TEMPLATE) {
        if (t.type !== "league") continue; // 日程はリーグ戦のみ（CSは麻雀CSで管理）
        if (existingDates.has(t.date)) continue;
        const ref = db.collection("mahjongSchedule").doc();
        batch.set(ref, { ...t, seasonId: season.seasonId, createdAt: now });
        added += 1;
      }
      await batch.commit();
      return NextResponse.json({ success: true, added });
    }

    const date: unknown = body?.date;
    const startTime: unknown = body?.startTime;
    const endTime: unknown = body?.endTime;
    const type: unknown = body?.type;
    if (
      typeof date !== "string" || !DATE_RE.test(date) ||
      typeof startTime !== "string" || !TIME_RE.test(startTime) ||
      typeof endTime !== "string" || !TIME_RE.test(endTime) ||
      (type !== "league" && type !== "championship")
    ) {
      return NextResponse.json({ error: "入力が不正です" }, { status: 400 });
    }

    const entry: Omit<MahjongScheduleEntry, "scheduleId"> = {
      seasonId: season.seasonId,
      date,
      startTime,
      endTime,
      type: type as MahjongScheduleType,
      createdAt: now,
    };
    const ref = await db.collection("mahjongSchedule").add(entry);
    return NextResponse.json({ entry: { ...entry, scheduleId: ref.id } }, { status: 201 });
  } catch (error) {
    console.error("[admin/mahjong/schedule] POST error:", error);
    return NextResponse.json({ error: "追加に失敗しました" }, { status: 500 });
  }
}

/** DELETE /api/admin/mahjong/schedule?scheduleId= */
export async function DELETE(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const scheduleId = req.nextUrl.searchParams.get("scheduleId");
    if (!scheduleId) {
      return NextResponse.json({ error: "scheduleId が必要です" }, { status: 400 });
    }
    await getDb().collection("mahjongSchedule").doc(scheduleId).delete();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/mahjong/schedule] DELETE error:", error);
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }
}
