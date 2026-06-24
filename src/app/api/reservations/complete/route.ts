import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { getFacilityById } from "@/lib/facilities";
import { requireProfileComplete } from "@/lib/auth";
import { createCalendarEvent } from "@/lib/googleCalendar";
import { sendReservationConfirmed, sendTrailerPasscodeNotice } from "@/lib/line";
import { verifySquareOrderPayment } from "@/lib/square";
import { generatePasscode, issueTimeLimitPasscodeWithRetry } from "@/lib/switchbot";
import { verifyPendingCookie, PENDING_RESERVATION_COOKIE } from "@/lib/trailerPending";
import { reservationEpochMs } from "@/lib/reservations";
import { notifyAdmin } from "@/lib/adminNotify";
import type { Reservation } from "@/types";
import dayjs from "dayjs";

export const dynamic = "force-dynamic";

/**
 * POST /api/reservations/complete  Body: { orderId }
 * Square 決済後リダイレクトからの確定処理。
 *  1. 署名Cookie → pending予約を特定（本人・未失効）
 *  2. Square API で取引照合（金額/COMPLETED/再利用なし）
 *  3. 予約を confirmed 化（Calendarイベント作成・transactionId保存）
 *  4. SwitchBot 時限パスコードを発行（失敗時リトライ→管理者通知・予約は確定のまま）
 *  5. LINE通知（解錠コード含む）
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireProfileComplete(req);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const { orderId } = (await req.json().catch(() => ({}))) as { orderId?: string };
    if (!orderId || typeof orderId !== "string") {
      return NextResponse.json({ error: "orderId がありません" }, { status: 400 });
    }

    // 署名Cookie → pending予約
    const cookie = req.cookies.get(PENDING_RESERVATION_COOKIE)?.value;
    const pending = cookie ? await verifyPendingCookie(cookie) : null;
    if (!pending || pending.lineUserId !== userId) {
      return NextResponse.json(
        { error: "PENDING_NOT_FOUND", message: "決済対象の予約が見つかりません。" },
        { status: 400 }
      );
    }

    const db = getDb();
    const reservationRef = db.collection("reservations").doc(pending.reservationId);
    const snap = await reservationRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "予約が見つかりません" }, { status: 404 });
    }
    const reservation = {
      reservationId: snap.id,
      ...(snap.data() as Omit<Reservation, "reservationId">),
    };

    // 冪等: 既に確定済みなら同じ結果（パスコード）を返す
    if (reservation.status === "confirmed") {
      return NextResponse.json({
        reservation,
        passcode: reservation.switchBotPasscode ?? null,
        passcodePending: reservation.switchBotStatus === "failed",
        alreadyDone: true,
      });
    }
    if (reservation.status !== "pending_payment" || reservation.lineUserId !== userId) {
      return NextResponse.json(
        { error: "INVALID_STATE", message: "この予約は確定できません。" },
        { status: 400 }
      );
    }
    if (reservation.pendingExpiresAt && reservation.pendingExpiresAt <= dayjs().toISOString()) {
      return NextResponse.json(
        { error: "EXPIRED", message: "仮押さえの期限が切れました。最初からやり直してください。" },
        { status: 410 }
      );
    }

    const facility = await getFacilityById(reservation.facilityId);
    if (!facility) {
      return NextResponse.json({ error: "施設が見つかりません" }, { status: 404 });
    }
    const expectedAmount = facility.paymentAmount ?? reservation.paymentAmount;
    if (!expectedAmount) {
      return NextResponse.json({ error: "決済額が未設定です" }, { status: 400 });
    }

    // ── Square 取引照合 ──
    let verified: { orderId: string; paymentId: string };
    try {
      verified = await verifySquareOrderPayment({ orderId, expectedAmount });
    } catch (e) {
      return NextResponse.json(
        {
          error: "PAYMENT_VERIFY_FAILED",
          message: e instanceof Error ? e.message : "決済の確認に失敗しました。",
        },
        { status: 402 }
      );
    }

    // ── 再利用防止: 同じ取引IDが他の予約で使われていないか ──
    const dupSnap = await db
      .collection("reservations")
      .where("paymentTransactionId", "==", verified.orderId)
      .get();
    if (dupSnap.docs.some((d) => d.id !== reservation.reservationId)) {
      return NextResponse.json(
        { error: "PAYMENT_REUSED", message: "この決済はすでに使用されています。" },
        { status: 409 }
      );
    }

    // ── Google Calendar イベント作成（失敗は致命ではない） ──
    let googleEventId = "";
    try {
      googleEventId = await createCalendarEvent(facility.calendarId, {
        date: reservation.date,
        startTime: reservation.startTime,
        endTime: reservation.endTime,
        summary: `${facility.name}（決済済）`,
        description: `予約者LINE ID: ${userId}\nSquare決済: ${verified.paymentId}`,
      });
    } catch (e) {
      console.error("[reservations/complete] calendar failed:", e);
    }

    const nowIso = dayjs().toISOString();
    const slotKey = encodeURIComponent(
      `${reservation.facilityId}_${reservation.date}_${reservation.startTime}_${reservation.endTime}`
    );

    // ── 確定（予約 + ロック） ──
    await reservationRef.update({
      status: "confirmed",
      paymentStatus: "completed",
      paymentId: verified.paymentId,
      paymentTransactionId: verified.orderId,
      googleEventId,
      updatedAt: nowIso,
    });
    await db
      .collection("reservationLocks")
      .doc(slotKey)
      .set(
        { status: "confirmed", reservationId: reservation.reservationId, updatedAt: nowIso },
        { merge: true }
      );

    // ── SwitchBot 時限パスコード発行 ──
    let passcode: string | null = null;
    let passcodePending = false;
    if (facility.switchBotDeviceId) {
      const code = generatePasscode();
      const startMs = reservationEpochMs(reservation.date, reservation.startTime);
      const endMs = reservationEpochMs(reservation.date, reservation.endTime);
      try {
        const { keyId } = await issueTimeLimitPasscodeWithRetry({
          deviceId: facility.switchBotDeviceId,
          name: reservation.reservationId,
          password: code,
          startMs,
          endMs,
        });
        passcode = code;
        await reservationRef.update({
          switchBotPasscode: code,
          switchBotKeyId: keyId,
          switchBotPasscodeExpiresAt: new Date(endMs).toISOString(),
          switchBotStatus: "issued",
        });
      } catch (e) {
        passcodePending = true;
        await reservationRef.update({ switchBotStatus: "failed" });
        await notifyAdmin(
          "switchbot_failed",
          `解錠コードの発行に失敗しました（予約 ${reservation.reservationId} / ${facility.name}）。手動で再発行してください。`,
          { reservationId: reservation.reservationId, facilityId: facility.id }
        );
        console.error("[reservations/complete] switchbot failed:", e);
      }
    }

    // ── LINE 通知（失敗しても確定は維持） ──
    try {
      const userDoc = await db.collection("users").doc(userId).get();
      const displayName = (userDoc.data()?.displayName as string) ?? userId;
      await sendReservationConfirmed(userId, {
        facilityName: facility.name,
        date: reservation.date,
        startTime: reservation.startTime,
        endTime: reservation.endTime,
        displayName,
      });
      if (passcode) {
        await sendTrailerPasscodeNotice(userId, {
          facilityName: facility.name,
          date: reservation.date,
          startTime: reservation.startTime,
          endTime: reservation.endTime,
          passcode,
        });
      }
    } catch (e) {
      console.error("[reservations/complete] line notify failed:", e);
    }

    const finalSnap = await reservationRef.get();
    const res = NextResponse.json({
      reservation: { reservationId: finalSnap.id, ...finalSnap.data() },
      passcode,
      passcodePending,
    });
    // 使い終わった pending Cookie を破棄
    res.cookies.set(PENDING_RESERVATION_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[reservations/complete] POST error:", message, err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "確定処理中にエラーが発生しました" },
      { status: 500 }
    );
  }
}
