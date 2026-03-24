import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { getFacilityById } from "@/lib/facilities";
import { deleteCalendarEvent } from "@/lib/googleCalendar";
import { sendReservationCancelled } from "@/lib/line";
import { getSessionUserId } from "@/lib/session";
import type { Reservation } from "@/types";

export const dynamic = "force-dynamic";

// ─── DELETE: 予約キャンセル ────────────────────────────────────────────────────
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = await getSessionUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const reservationId = params.id;
  const db = getDb();

  // Firestore から予約取得
  const docRef = db.collection("reservations").doc(reservationId);
  const doc = await docRef.get();

  if (!doc.exists) {
    return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
  }

  const reservation = { reservationId: doc.id, ...doc.data() } as Reservation;

  // 本人確認
  if (reservation.lineUserId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // すでにキャンセル済みか確認
  if (reservation.status === "cancelled") {
    return NextResponse.json(
      { error: "Already cancelled" },
      { status: 409 }
    );
  }

  // キャンセル期限チェック（開始30分前まで）
  const now = new Date();
  const reservationStart = new Date(
    `${reservation.date}T${reservation.startTime}:00+09:00`
  );
  const diffMinutes = (reservationStart.getTime() - now.getTime()) / 60000;
  if (diffMinutes < 30) {
    return NextResponse.json(
      {
        error: "CANCEL_DEADLINE_PASSED",
        message: "開始30分前を過ぎているためキャンセルできません。",
      },
      { status: 422 }
    );
  }

  // Google Calendar からイベント削除
  const facility = getFacilityById(reservation.facilityId);
  if (facility) {
    try {
      await deleteCalendarEvent(facility.calendarId, reservation.googleEventId);
    } catch (err) {
      console.error("Calendar delete failed:", err);
      // カレンダー削除失敗でも Firestore は更新する（管理者が手動対処）
    }
  }

  // Firestore のステータスを cancelled に更新
  await docRef.update({ status: "cancelled" });

  // LINE 通知送信
  try {
    await sendReservationCancelled(userId, {
      facilityName: reservation.facilityName,
      date: reservation.date,
      startTime: reservation.startTime,
      endTime: reservation.endTime,
    });
  } catch (err) {
    console.error("LINE notification failed:", err);
  }

  return NextResponse.json({ message: "予約をキャンセルしました。" });
}
