import { NextRequest, NextResponse } from "next/server";
import { getFacilityById } from "@/lib/facilities";
import { checkAvailability, getBookedSlots } from "@/lib/googleCalendar";
import { requireActiveUser } from "@/lib/auth";
import { validateReservationSlot } from "@/lib/reservations";
import type { AvailabilityResponse } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const userId = await requireActiveUser(req);
  if (!userId) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

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

  const facility = await getFacilityById(facilityId);
  if (!facility) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  // startTime/endTime が省略された場合は予約済みスロット一覧だけ返す（タイムスロット画面の初期ロード用）
  if (!startTime || !endTime) {
    const bookedSlots = await getBookedSlots(facility.calendarId, date);
    // 空き状況は常に最新を返す（HTTPキャッシュ禁止）
    return NextResponse.json(
      { bookedSlots },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // スロット妥当性（過去日・曜日・営業時間・固定枠）は予約POSTと同じ validateReservationSlot を使う。
  // 規約同意は確認時には問わない（enforceTerms 既定 false）。
  const slotValidation = validateReservationSlot(facility, { date, startTime, endTime });
  if (!slotValidation.ok) {
    const reason = slotValidation.reason === "PAST_DATE" ? "PAST_DATE" : "OUT_OF_HOURS";
    const res: AvailabilityResponse = { available: false, reason };
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
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

  // この空き判定結果もキャッシュさせない（予約確定時にサーバーが再検証する前提は不変）
  return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
}
