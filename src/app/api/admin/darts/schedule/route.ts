import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getActiveSeason } from "@/lib/mahjong";
import { listDartsSchedule } from "@/lib/dartsSchedule";
import {
  buildDartsScheduleId,
  isValidDartsDate,
  generateBiweeklyThursdays,
  isThursdayDate,
} from "@/lib/dartsEntryValidation";
import { DARTS_DEFAULT_START_TIME, DARTS_DEFAULT_END_TIME, type DartsScheduleEntry } from "@/types/darts";

export const dynamic = "force-dynamic";

const TIME_RE = /^\d{2}:\d{2}$/;

/** GET /api/admin/darts/schedule?seasonId= — 開催日一覧（日付順）。 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    let seasonId = req.nextUrl.searchParams.get("seasonId");
    if (!seasonId) {
      const season = await getActiveSeason("darts");
      if (!season) return NextResponse.json({ schedule: [], seasonId: null });
      seasonId = season.seasonId;
    }
    const schedule = await listDartsSchedule(seasonId);
    return NextResponse.json({ schedule, seasonId });
  } catch (error) {
    console.error("[admin/darts/schedule] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

/**
 * POST /api/admin/darts/schedule — 開催日を登録。body のいずれか:
 *   - { biweekly: { startDate, count } } … 起点以降の隔週木曜を count 個一括登録（重複はスキップ）
 *   - { date, startTime?, endTime? } … 1件追加（時刻の既定は 18:00-20:00）
 * docId は `${seasonId}_${date}`（決定的）＝開催日の実在確認を O(1) にする。
 */
export async function POST(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const season = await getActiveSeason("darts");
    if (!season) {
      return NextResponse.json({ error: "アクティブなダーツシーズンがありません" }, { status: 400 });
    }
    const db = getDb();
    const body = await req.json().catch(() => null);
    const now = new Date().toISOString();

    const makeEntry = (date: string, startTime: string, endTime: string): DartsScheduleEntry => ({
      scheduleId: buildDartsScheduleId(season.seasonId, date),
      seasonId: season.seasonId,
      date,
      startTime,
      endTime,
      createdAt: now,
    });

    // 一括: 隔週木曜
    if (body?.biweekly && typeof body.biweekly === "object") {
      const { startDate, count } = body.biweekly as { startDate?: unknown; count?: unknown };
      if (!isValidDartsDate(startDate) || !Number.isInteger(count) || (count as number) < 1 || (count as number) > 60) {
        return NextResponse.json({ error: "biweekly の startDate / count が不正です" }, { status: 400 });
      }
      const startTime = typeof body.startTime === "string" && TIME_RE.test(body.startTime) ? body.startTime : DARTS_DEFAULT_START_TIME;
      const endTime = typeof body.endTime === "string" && TIME_RE.test(body.endTime) ? body.endTime : DARTS_DEFAULT_END_TIME;
      const dates = generateBiweeklyThursdays(startDate, count as number);
      const batch = db.batch();
      let added = 0;
      for (const date of dates) {
        const ref = db.collection("dartsSchedule").doc(buildDartsScheduleId(season.seasonId, date));
        // 決定的IDなので merge:false で上書き（重複日は同一内容で冪等）。
        batch.set(ref, makeEntry(date, startTime, endTime));
        added += 1;
      }
      await batch.commit();
      return NextResponse.json({ success: true, added, dates });
    }

    // 単一
    const date: unknown = body?.date;
    if (!isValidDartsDate(date)) {
      return NextResponse.json({ error: "date が不正です" }, { status: 400 });
    }
    const startTime = typeof body?.startTime === "string" && TIME_RE.test(body.startTime) ? body.startTime : DARTS_DEFAULT_START_TIME;
    const endTime = typeof body?.endTime === "string" && TIME_RE.test(body.endTime) ? body.endTime : DARTS_DEFAULT_END_TIME;
    const entry = makeEntry(date, startTime, endTime);
    await db.collection("dartsSchedule").doc(entry.scheduleId).set(entry);
    // 木曜以外は警告を添える（登録は許可＝祝日振替等に対応）。
    return NextResponse.json(
      { entry, warning: isThursdayDate(date) ? null : "この開催日は木曜日ではありません" },
      { status: 201 }
    );
  } catch (error) {
    console.error("[admin/darts/schedule] POST error:", error);
    return NextResponse.json({ error: "登録に失敗しました" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/darts/schedule?date=YYYY-MM-DD&seasonId= — 開催日を削除（休止）。
 * 参加者がいる開催日は削除できない（409）。中止(流会)は別途 day/cancel（Phase 3）。
 */
export async function DELETE(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    let seasonId = req.nextUrl.searchParams.get("seasonId");
    if (!seasonId) {
      const season = await getActiveSeason("darts");
      if (!season) return NextResponse.json({ error: "seasonId が必要です" }, { status: 400 });
      seasonId = season.seasonId;
    }
    const date = req.nextUrl.searchParams.get("date");
    if (!isValidDartsDate(date)) {
      return NextResponse.json({ error: "date が不正です" }, { status: 400 });
    }
    const db = getDb();
    // 参加者がいる日は消さない（参加/決済の宙ぶらりんを防ぐ）。
    const entrySnap = await db
      .collection("dartsEntries")
      .where("seasonId", "==", seasonId)
      .where("eventDate", "==", date)
      .limit(1)
      .get();
    if (!entrySnap.empty) {
      return NextResponse.json({ error: "参加者がいるため削除できません" }, { status: 409 });
    }
    await db.collection("dartsSchedule").doc(buildDartsScheduleId(seasonId, date)).delete();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/darts/schedule] DELETE error:", error);
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }
}
