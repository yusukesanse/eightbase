import { NextRequest, NextResponse } from "next/server";
import { getFacilityById } from "@/lib/facilities";
import { checkAvailability, getBookedSlots } from "@/lib/googleCalendar";
import type { AvailabilityResponse } from "@/types";

export const dynamic = "force-dynamic";

// 営業時間（分）
const OPEN_MINUTES  = 9 * 60;   // 9:00
const CLOSE_MINUTES = 18 * 60;  // 18:00

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const facilityId = searchParams.get("facilityId");
  const date       = searchParams.get("date");
  const startTime  = searchParams.get("startTime");
  const endTime    = searchParams.get("endTime");

  if (!facilityId || !date) {
    return NextResponse.json(
      { error: "facilityId, date are required" },
      { status: 400 }
    );
  }

  const facility = getFacilityById(facilityId);
  if (!facility) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  // startTime/endTime が省略された場合は予約済みスロット一覧だけ返す（タイムスロット画面の初期ロード用）
  if (!startTime || !endTime) {
    const bookedSlots = await getBookedSlots(facility.calendarId, date);
    return NextResponse.json({ bookedSlots });
  }

  // 過去日チェック
  const today = new Date().toISOString().split("T")[0];
  if (date < today) {
    const res: AvailabilityResponse = { available: false, reason: "PAST_DATE" };
    return NextResponse.json(res);
  }

  // 土日チェック
  const dayOfWeek = new Date(date).getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    const res: AvailabilityResponse = { available: false, reason: "OUT_OF_HOURS" };
    return NextResponse.json(res);
  }

  // 営業時間チェック
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  if (sh * 60 + sm < OPEN_MINUTES || eh * 60 + em > CLOSE_MINUTES) {
    const res: AvailabilityResponse = { available: false, reason: "OUT_OF_HOURS" };
    return NextResponse.json(res);
  }

  // Google Calendar で重複チェック
  const available = await checkAvailability(
    facility.calendarId,
    date,
    startTime,
    endTime
  );

  const bookedSlots = available
    ? undefined
    : await getBookedSlots(facility.calendarId, date);

  const res: AvailabilityResponse = {
    available,
    reason: available ? undefined : "ALREADY_BOOKED",
    bookedSlots,
  };

  return NextResponse.json(res);
}
