import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { getFacilityById } from "@/lib/facilities";
import { getBookedSlots } from "@/lib/googleCalendar";
import { requireActiveUser } from "@/lib/auth";
import { getPendingLockedSlots } from "@/lib/reservations";
import dayjs from "dayjs";

export const dynamic = "force-dynamic";

/**
 * 1週間分（月曜起点の7日間）の予約済みスロットを取得する。
 * 施設の availableDays に含まれない日は空配列を返す。
 * Query: facilityId, weekStart (YYYY-MM-DD の月曜日)
 * Response: { [date: string]: { start: string; end: string }[] }
 */
export async function GET(req: NextRequest) {
  const userId = await requireActiveUser(req);
  if (!userId) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const facilityId = searchParams.get("facilityId");
  const weekStart  = searchParams.get("weekStart"); // YYYY-MM-DD (月曜)

  if (!facilityId || !weekStart) {
    return NextResponse.json(
      { error: "facilityId and weekStart are required" },
      { status: 400 }
    );
  }

  const facility = await getFacilityById(facilityId);
  if (!facility) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  const availableDays = facility.availableDays ?? [1, 2, 3, 4, 5];
  const nowIso = dayjs().toISOString();
  const db = getDb();

  try {
    // 月曜起点の7日分を並列取得（利用不可曜日は空配列）
    const result: Record<string, { start: string; end: string }[]> = {};

    await Promise.all(
      Array.from({ length: 7 }, (_, i) => {
        const d = dayjs(weekStart).add(i, "day");
        const date = d.format("YYYY-MM-DD");
        if (!availableDays.includes(d.day())) {
          result[date] = [];
          return Promise.resolve();
        }
        // Google Calendar（確定）＋ 決済前の仮押さえ（pending）を合算
        return Promise.all([
          getBookedSlots(facility.calendarId, date),
          getPendingLockedSlots(db, facilityId, date, nowIso),
        ]).then(([cal, pending]) => {
          result[date] = [...cal, ...pending];
        });
      })
    );

    // 空き状況は常に最新を返す（HTTPキャッシュ禁止）
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[week-availability] error:", message);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message },
      { status: 500 }
    );
  }
}
