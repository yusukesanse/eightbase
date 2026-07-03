import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { getFacilityById } from "@/lib/facilities";
import { checkAvailability, getBookedSlots } from "@/lib/googleCalendar";
import { requireMember } from "@/lib/auth";
import {
  validateReservationSlot,
  getPendingLockedSlots,
  intervalsOverlap,
  timeToMin,
} from "@/lib/reservations";
import type { AvailabilityResponse } from "@/types";
import dayjs from "dayjs";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const userId = await requireMember(req);
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

  const nowIso = dayjs().toISOString();

  // startTime/endTime が省略された場合は予約済みスロット一覧だけ返す（タイムスロット画面の初期ロード用）
  if (!startTime || !endTime) {
    // Google Calendar（確定予約）＋ 決済前の仮押さえ（pending）を合算して返す。
    const [calendarBooked, pendingBooked] = await Promise.all([
      getBookedSlots(facility.calendarId, date),
      getPendingLockedSlots(getDb(), facilityId, date, nowIso),
    ]);
    // 空き状況は常に最新を返す（HTTPキャッシュ禁止）
    return NextResponse.json(
      { bookedSlots: [...calendarBooked, ...pendingBooked] },
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

  // Google Calendar（確定）＋ pending 仮押さえの両方で重複チェック
  const pendingBooked = await getPendingLockedSlots(getDb(), facilityId, date, nowIso);
  const overlapsPending = pendingBooked.some((p) =>
    intervalsOverlap(timeToMin(startTime), timeToMin(endTime), timeToMin(p.start), timeToMin(p.end))
  );
  const calAvailable = await checkAvailability(
    facility.calendarId,
    date,
    startTime,
    endTime
  );
  const available = calAvailable && !overlapsPending;

  const bookedSlots = available
    ? undefined
    : [...(await getBookedSlots(facility.calendarId, date)), ...pendingBooked];

  const res: AvailabilityResponse = {
    available,
    reason: available ? undefined : "ALREADY_BOOKED",
    bookedSlots,
  };

  // この空き判定結果もキャッシュさせない（予約確定時にサーバーが再検証する前提は不変）
  return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
}
