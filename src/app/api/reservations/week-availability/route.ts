import { NextRequest, NextResponse } from "next/server";
import { getFacilityById } from "@/lib/facilities";
import { getBookedSlots } from "@/lib/googleCalendar";
import dayjs from "dayjs";

export const dynamic = "force-dynamic";

/**
 * 1週間分（月〜金）の予約済みスロットを取得する。
 * Query: facilityId, weekStart (YYYY-MM-DD の月曜日)
 * Response: { [date: string]: { start: string; end: string }[] }
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const facilityId = searchParams.get("facilityId");
  const weekStart  = searchParams.get("weekStart"); // YYYY-MM-DD (月曜)

  if (!facilityId || !weekStart) {
    return NextResponse.json(
      { error: "facilityId and weekStart are required" },
      { status: 400 }
    );
  }

  const facility = getFacilityById(facilityId);
  if (!facility) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  try {
    // 月〜金の5日分を並列取得
    const result: Record<string, { start: string; end: string }[]> = {};

    await Promise.all(
      Array.from({ length: 5 }, (_, i) => {
        const date = dayjs(weekStart).add(i, "day").format("YYYY-MM-DD");
        return getBookedSlots(facility.calendarId, date).then((slots) => {
          result[date] = slots;
        });
      })
    );

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[week-availability] error:", message);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message },
      { status: 500 }
    );
  }
}
