import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { getFacilityById } from "@/lib/facilities";
import { requireMember } from "@/lib/auth";
import {
  validateReservationSlot,
  getBlockingLockedSlots,
  intervalsOverlap,
} from "@/lib/reservations";
import { getCalendarBusySlotsSafe } from "@/lib/calendarBusy";
import { timeToMin } from "@/lib/date";
import type { AvailabilityResponse, UnavailableReason } from "@/types";
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
  // "null"/"undefined" 等の不正値で空の bookedSlots を返すとクライアントのキャッシュを汚すため明示拒否
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "date は YYYY-MM-DD 形式で指定してください" },
      { status: 400 }
    );
  }

  const facility = await getFacilityById(facilityId);
  if (!facility) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  const nowIso = dayjs().toISOString();

  // 空きは Firestore の reservationLocks（confirmed ＋ 未失効 pending）と、
  // **Google カレンダーに直接入れられた予定**の両方で塞ぐ。
  // GCal 側を見ないと、カレンダーから入れた予約がミニアプリでは空きに見える（2026-08-06 の不具合）。
  // GCal が読めないときは Firestore ぶんだけ返す（表示は止めない）。確定時は必ずサーバーが再検証する。
  const [locked, gcalByDate] = await Promise.all([
    getBlockingLockedSlots(getDb(), facilityId, date, nowIso),
    getCalendarBusySlotsSafe(facility.calendarId, [date]),
  ]);
  const booked = [...locked, ...(gcalByDate[date] ?? [])];

  // startTime/endTime が省略された場合は予約済みスロット一覧だけ返す（タイムスロット画面の初期ロード用）
  if (!startTime || !endTime) {
    // 空き状況は常に最新を返す（HTTPキャッシュ禁止）
    return NextResponse.json(
      { bookedSlots: booked },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // スロット妥当性（過去日・曜日・営業時間・固定枠）は予約POSTと同じ validateReservationSlot を使う。
  // 規約同意は確認時には問わない（enforceTerms 既定 false）。
  const slotValidation = validateReservationSlot(facility, { date, startTime, endTime });
  if (!slotValidation.ok) {
    // PAST_DATE / TOO_SOON はそのまま返す（利用者に理由を出し分けるため）。
    // それ以外（曜日・営業時間・固定枠）はまとめて OUT_OF_HOURS。
    const reason: UnavailableReason =
      slotValidation.reason === "PAST_DATE"
        ? "PAST_DATE"
        : slotValidation.reason === "TOO_SOON"
          ? "TOO_SOON"
          : "OUT_OF_HOURS";
    const res: AvailabilityResponse = { available: false, reason };
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
  }

  // 重複チェックも同じ Firestore ロック集合で行う（表示と判定が必ず一致）。最終判定は予約POSTの transaction。
  const overlaps = booked.some((b) =>
    intervalsOverlap(timeToMin(startTime), timeToMin(endTime), timeToMin(b.start), timeToMin(b.end))
  );
  const available = !overlaps;

  const res: AvailabilityResponse = {
    available,
    reason: available ? undefined : "ALREADY_BOOKED",
    bookedSlots: available ? undefined : booked,
  };

  // この空き判定結果もキャッシュさせない（予約確定時にサーバーが再検証する前提は不変）
  return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
}
