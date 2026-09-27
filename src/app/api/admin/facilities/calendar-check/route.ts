import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getFacilityById } from "@/lib/facilities";
import { readCalendarDay, summarizeEventsForDate, busyIntervalsForDate } from "@/lib/calendarBusy";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!await checkAdminAuth(req)) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const { facilityId, date } = body ?? {};
  const parsedDate = typeof date === "string" ? new Date(`${date}T00:00:00Z`) : null;
  if (typeof facilityId !== "string" || !facilityId.trim() ||
      typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !parsedDate || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    return NextResponse.json({ error: "facilityId と YYYY-MM-DD 形式の有効な date は必須です" }, { status: 400 });
  }
  const facility = await getFacilityById(facilityId);
  if (!facility) {
    return NextResponse.json({ error: "施設が見つかりません" }, { status: 404 });
  }
  const result = facility.calendarId
    ? await readCalendarDay(facility.calendarId, date)
    : { ok: false as const, errorKind: "not_configured" as const };
  if (!result.ok) {
    return NextResponse.json({ ok: false, errorKind: result.errorKind, events: [], busyIntervals: [] }, { headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({
    ok: true,
    events: summarizeEventsForDate(result.events, date),
    busyIntervals: busyIntervalsForDate(result.events, date),
  }, { headers: { "Cache-Control": "no-store" } });
}
