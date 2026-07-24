import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getActiveSeason } from "@/lib/mahjong";
import { listPokerSchedule } from "@/lib/pokerSchedule";
import {
  buildPokerScheduleId,
  isValidPokerDate,
  generateFirstThirdSaturdays,
  isSaturdayDate,
} from "@/lib/pokerEntryValidation";
import { POKER_DEFAULT_START_TIME, POKER_DEFAULT_END_TIME, type PokerScheduleEntry } from "@/types/poker";

export const dynamic = "force-dynamic";

const TIME_RE = /^\d{2}:\d{2}$/;

/** GET /api/admin/poker/schedule?seasonId= — 開催日一覧（日付順）。 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    let seasonId = req.nextUrl.searchParams.get("seasonId");
    if (!seasonId) {
      const season = await getActiveSeason("poker");
      if (!season) return NextResponse.json({ schedule: [], seasonId: null });
      seasonId = season.seasonId;
    }
    const schedule = await listPokerSchedule(seasonId);
    return NextResponse.json({ schedule, seasonId });
  } catch (error) {
    console.error("[admin/poker/schedule] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

/**
 * POST /api/admin/poker/schedule — 開催日を登録。body のいずれか:
 *   - { biweekly: { startDate, count } } … 起点以降の第1/第3土曜を count 個一括登録（重複は上書き）
 *   - { date, startTime?, endTime? } … 1件追加（時刻の既定は 13:00-18:00）
 */
export async function POST(req: NextRequest) {
  if (!(await checkAdminAuth(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const season = await getActiveSeason("poker");
    if (!season) return NextResponse.json({ error: "アクティブなポーカーシーズンがありません" }, { status: 400 });
    const db = getDb();
    const body = await req.json().catch(() => null);
    const now = new Date().toISOString();

    const makeEntry = (date: string, startTime: string, endTime: string): PokerScheduleEntry => ({
      scheduleId: buildPokerScheduleId(season.seasonId, date),
      seasonId: season.seasonId,
      date,
      startTime,
      endTime,
      createdAt: now,
    });

    if (body?.biweekly && typeof body.biweekly === "object") {
      const { startDate, count } = body.biweekly as { startDate?: unknown; count?: unknown };
      if (!isValidPokerDate(startDate) || !Number.isInteger(count) || (count as number) < 1 || (count as number) > 60) {
        return NextResponse.json({ error: "biweekly の startDate / count が不正です" }, { status: 400 });
      }
      const startTime = typeof body.startTime === "string" && TIME_RE.test(body.startTime) ? body.startTime : POKER_DEFAULT_START_TIME;
      const endTime = typeof body.endTime === "string" && TIME_RE.test(body.endTime) ? body.endTime : POKER_DEFAULT_END_TIME;
      const dates = generateFirstThirdSaturdays(startDate, count as number);
      const batch = db.batch();
      for (const date of dates) {
        batch.set(db.collection("pokerSchedule").doc(buildPokerScheduleId(season.seasonId, date)), makeEntry(date, startTime, endTime));
      }
      await batch.commit();
      return NextResponse.json({ success: true, added: dates.length, dates });
    }

    const date: unknown = body?.date;
    if (!isValidPokerDate(date)) return NextResponse.json({ error: "date が不正です" }, { status: 400 });
    const startTime = typeof body?.startTime === "string" && TIME_RE.test(body.startTime) ? body.startTime : POKER_DEFAULT_START_TIME;
    const endTime = typeof body?.endTime === "string" && TIME_RE.test(body.endTime) ? body.endTime : POKER_DEFAULT_END_TIME;
    const entry = makeEntry(date, startTime, endTime);
    await db.collection("pokerSchedule").doc(entry.scheduleId).set(entry);
    return NextResponse.json({ entry, warning: isSaturdayDate(date) ? null : "この開催日は土曜日ではありません" }, { status: 201 });
  } catch (error) {
    console.error("[admin/poker/schedule] POST error:", error);
    return NextResponse.json({ error: "登録に失敗しました" }, { status: 500 });
  }
}

/** DELETE /api/admin/poker/schedule?date=YYYY-MM-DD&seasonId= — 開催日を削除（参加者がいる日は409）。 */
export async function DELETE(req: NextRequest) {
  if (!(await checkAdminAuth(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    let seasonId = req.nextUrl.searchParams.get("seasonId");
    if (!seasonId) {
      const season = await getActiveSeason("poker");
      if (!season) return NextResponse.json({ error: "seasonId が必要です" }, { status: 400 });
      seasonId = season.seasonId;
    }
    const date = req.nextUrl.searchParams.get("date");
    if (!isValidPokerDate(date)) return NextResponse.json({ error: "date が不正です" }, { status: 400 });
    const db = getDb();
    const entrySnap = await db
      .collection("pokerEntries")
      .where("seasonId", "==", seasonId)
      .where("eventDate", "==", date)
      .limit(1)
      .get();
    if (!entrySnap.empty) return NextResponse.json({ error: "参加者がいるため削除できません" }, { status: 409 });
    await db.collection("pokerSchedule").doc(buildPokerScheduleId(seasonId, date)).delete();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/poker/schedule] DELETE error:", error);
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }
}
