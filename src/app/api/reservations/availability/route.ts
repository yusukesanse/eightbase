import { NextRequest, NextResponse } from "next/server";
import { getFacilityById } from "@/lib/facilities";
import { checkAvailability, getBookedSlots } from "@/lib/googleCalendar";
import { requireActiveUser } from "@/lib/auth";
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

  // 施設ごとの利用時間設定（デフォルト: 9:00〜18:00、平日のみ）
  const [oh, om] = (facility.openTime ?? "09:00").split(":").map(Number);
  const [ch, cm] = (facility.closeTime ?? "18:00").split(":").map(Number);
  const OPEN_MINUTES  = oh * 60 + om;
  const CLOSE_MINUTES = ch * 60 + cm;
  const availableDays = facility.availableDays ?? [1, 2, 3, 4, 5];

  // startTime/endTime が省略された場合は予約済みスロット一覧だけ返す（タイムスロット画面の初期ロード用）
  if (!startTime || !endTime) {
    const bookedSlots = await getBookedSlots(facility.calendarId, date);
    // 空き状況は常に最新を返す（HTTPキャッシュ禁止）
    return NextResponse.json(
      { bookedSlots },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // 過去日チェック
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
  if (date < today) {
    const res: AvailabilityResponse = { available: false, reason: "PAST_DATE" };
    return NextResponse.json(res);
  }

  // 利用可能曜日チェック
  const dayOfWeek = new Date(date + "T00:00:00+09:00").getDay();
  if (!availableDays.includes(dayOfWeek)) {
    const res: AvailabilityResponse = { available: false, reason: "OUT_OF_HOURS" };
    return NextResponse.json(res);
  }

  // 利用時間チェック
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

  // この空き判定結果もキャッシュさせない（予約確定時にサーバーが再検証する前提は不変）
  return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
}
