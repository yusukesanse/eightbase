import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { getFacilityById } from "@/lib/facilities";
import { deleteCalendarEvent } from "@/lib/googleCalendar";
import { sendReservationCancelled } from "@/lib/line";
import { requireMember } from "@/lib/auth";
import { buildReservationSlotKey } from "@/lib/reservations";
import { deletePasscode } from "@/lib/switchbot";
import { notifyAdmin } from "@/lib/adminNotify";
import type { Reservation } from "@/types";

export const dynamic = "force-dynamic";

// ─── DELETE: 予約キャンセル ────────────────────────────────────────────────────
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = await requireMember(req);
  if (!userId) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
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

  // キャンセル期限チェック（終了時刻まで可能）
  const now = new Date();
  const reservationEnd = new Date(
    `${reservation.date}T${reservation.endTime}:00+09:00`
  );
  if (now.getTime() >= reservationEnd.getTime()) {
    return NextResponse.json(
      {
        error: "CANCEL_DEADLINE_PASSED",
        message: "予約の終了時刻を過ぎているためキャンセルできません。",
      },
      { status: 422 }
    );
  }

  // Google Calendar からイベント削除
  const facility = await getFacilityById(reservation.facilityId);
  if (facility) {
    try {
      await deleteCalendarEvent(facility.calendarId, reservation.googleEventId);
    } catch (err) {
      console.error("Calendar delete failed:", err);
      // カレンダー削除失敗でも Firestore は更新する（管理者が手動対処）
    }
  }

  // Firestore のステータスを cancelled に更新
  const slotRef = db
    .collection("reservationLocks")
    .doc(buildReservationSlotKey(
      reservation.facilityId,
      reservation.date,
      reservation.startTime,
      reservation.endTime
    ));
  await db.runTransaction(async (tx) => {
    tx.update(docRef, { status: "cancelled" });
    tx.delete(slotRef);
  });

  // トレーラー等: 解錠コードを即時無効化（残存させない）し、返金対応を管理者へ通知。
  if (reservation.switchBotKeyId && facility?.switchBotDeviceId) {
    try {
      await deletePasscode(facility.switchBotDeviceId, reservation.switchBotKeyId);
    } catch (err) {
      console.error("[reservations DELETE] passcode revoke failed:", err);
    }
  }
  if (reservation.paymentTransactionId || reservation.switchBotPasscode) {
    await notifyAdmin(
      "trailer_cancel",
      `トレーラー予約が取り消されました。返金対応をお願いします（予約 ${reservation.reservationId} / ${reservation.facilityName} / ${reservation.date} ${reservation.startTime}〜${reservation.endTime}）。`,
      {
        reservationId: reservation.reservationId,
        facilityId: reservation.facilityId,
        paymentTransactionId: reservation.paymentTransactionId ?? null,
      }
    );
  }

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
