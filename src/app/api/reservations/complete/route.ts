import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { getFacilityById } from "@/lib/facilities";
import { requireMemberProfileComplete } from "@/lib/auth";
import { createCalendarEvent, deleteCalendarEvent } from "@/lib/googleCalendar";
import { sendReservationConfirmed, sendTrailerPasscodeNotice } from "@/lib/line";
import { verifySquareOrderPayment } from "@/lib/square";
import { generatePasscode, issueTimeLimitPasscodeWithRetry } from "@/lib/switchbot";
import { reservationEpochMs, buildReservationSlotKey } from "@/lib/reservations";
import { notifyAdmin } from "@/lib/adminNotify";
import { writeReservationAudit } from "@/lib/reservationAudit";
import type { Reservation } from "@/types";
import dayjs from "dayjs";

export const dynamic = "force-dynamic";

/**
 * POST /api/reservations/complete  Body: { rid }（予約ID）
 * Square 決済後リダイレクト（/reservation/complete?rid=...）からの確定処理。
 *  1. rid → pending予約を特定（本人）。決済の注文IDは予約に保存済み（動的リンク方式）。
 *  2. Square API で取引照合（金額/COMPLETED/再利用なし）
 *  3. 予約を confirmed 化（Calendarイベント作成・transactionId保存）
 *  4. SwitchBot 時限パスコードを発行（失敗時リトライ→管理者通知・予約は確定のまま）
 *  5. LINE通知（解錠コード含む）
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireMemberProfileComplete(req);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const { rid } = (await req.json().catch(() => ({}))) as { rid?: string };
    if (!rid || typeof rid !== "string") {
      return NextResponse.json({ error: "rid がありません" }, { status: 400 });
    }

    const db = getDb();
    const reservationRef = db.collection("reservations").doc(rid);
    const snap = await reservationRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "予約が見つかりません" }, { status: 404 });
    }
    const reservation = {
      reservationId: snap.id,
      ...(snap.data() as Omit<Reservation, "reservationId">),
    };
    // 本人の予約か（rid はURL由来なので所有者をセッションで確認）
    if (reservation.lineUserId !== userId) {
      return NextResponse.json(
        { error: "PENDING_NOT_FOUND", message: "決済対象の予約が見つかりません。" },
        { status: 400 }
      );
    }

    // 冪等: 既に確定済みなら同じ結果（パスコード）を返す
    if (reservation.status === "confirmed") {
      return NextResponse.json({
        reservation,
        passcode: reservation.switchBotPasscode ?? null,
        passcodePending: reservation.switchBotStatus === "failed" || reservation.switchBotStatus === "manual",
        alreadyDone: true,
      });
    }
    if (reservation.status !== "pending_payment" || reservation.lineUserId !== userId) {
      return NextResponse.json(
        { error: "INVALID_STATE", message: "この予約は確定できません。" },
        { status: 400 }
      );
    }
    const facility = await getFacilityById(reservation.facilityId);
    if (!facility) {
      return NextResponse.json({ error: "施設が見つかりません" }, { status: 404 });
    }
    // 金額は pending 作成時に確定した予約側を優先（決済中の価格改定に影響されない）。
    const expectedAmount = reservation.paymentAmount ?? facility.paymentAmount;
    if (!expectedAmount) {
      return NextResponse.json({ error: "決済額が未設定です" }, { status: 400 });
    }
    // 照合に使う注文IDは pending 作成時にこの予約専用リンクの注文として保存済み。
    const orderId = reservation.paymentTransactionId;
    if (!orderId) {
      return NextResponse.json(
        { error: "NO_ORDER", message: "この予約に決済情報がありません。" },
        { status: 400 }
      );
    }

    // 仮押さえ失効: ただし決済が成立していれば、黙って課金せず管理者へ返金依頼を通知する。
    if (reservation.pendingExpiresAt && reservation.pendingExpiresAt <= dayjs().toISOString()) {
      try {
        await verifySquareOrderPayment({ orderId, expectedAmount });
        // orderId を一度だけ記録し、初回のみ通知（リトライで返金通知が重複しないように）。
        let firstTime = false;
        const expiredOrderRef = db.collection("squareOrders").doc(orderId);
        await db.runTransaction(async (tx) => {
          const d = await tx.get(expiredOrderRef);
          if (d.exists) return;
          tx.create(expiredOrderRef, {
            reservationId: reservation.reservationId,
            expiredRefund: true,
            createdAt: dayjs().toISOString(),
          });
          firstTime = true;
        });
        if (firstTime) {
          await notifyAdmin(
            "trailer_cancel",
            `仮押さえ期限切れ後に決済が成立しました。返金対応をお願いします（予約 ${reservation.reservationId} / 注文 ${orderId}）。`,
            { reservationId: reservation.reservationId, orderId, facilityId: facility.id }
          );
        }
      } catch {
        /* 未決済なら通知不要 */
      }
      return NextResponse.json(
        {
          error: "EXPIRED",
          message: "仮押さえの期限が切れました。決済済みの場合は返金対応します（管理者に通知済み）。",
        },
        { status: 410 }
      );
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

    const nowIso = dayjs().toISOString();
    // 確定tx に googleEventId を含められるよう、先に Calendar イベントを作成する
    // （確定が成立しなかった場合は下の abort 補償でこのイベントを削除し孤児化を防ぐ）。
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

    const slotRef = db
      .collection("reservationLocks")
      .doc(
        buildReservationSlotKey(
          reservation.facilityId,
          reservation.date,
          reservation.startTime,
          reservation.endTime
        )
      );
    // 取引IDの一意ドキュメントで「再利用防止」と「確定」を1 transaction に原子化
    // （二度押し/並行リクエストでも 1決済=1予約。pending再確認で同一予約の二重確定も防ぐ）。
    const orderRef = db.collection("squareOrders").doc(verified.orderId);
    try {
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(reservationRef);
        if (!fresh.exists || fresh.data()?.status !== "pending_payment") {
          throw new Error("ALREADY_FINALIZED");
        }
        const orderDoc = await tx.get(orderRef);
        if (orderDoc.exists) {
          throw new Error("PAYMENT_REUSED");
        }
        tx.create(orderRef, {
          reservationId: reservation.reservationId,
          paymentId: verified.paymentId,
          lineUserId: userId,
          createdAt: nowIso,
        });
        tx.update(reservationRef, {
          status: "confirmed",
          paymentStatus: "completed",
          paymentId: verified.paymentId,
          paymentTransactionId: verified.orderId,
          googleEventId,
          updatedAt: nowIso,
        });
        tx.set(
          slotRef,
          { status: "confirmed", reservationId: reservation.reservationId, updatedAt: nowIso },
          { merge: true }
        );
      });
    } catch (e) {
      // 確定が成立しなかった → 作成済み Calendar イベントを補償削除（孤児化防止）。
      if (googleEventId) {
        await deleteCalendarEvent(facility.calendarId, googleEventId).catch(() => {});
      }
      const m = e instanceof Error ? e.message : "";
      if (m === "PAYMENT_REUSED") {
        return NextResponse.json(
          { error: "PAYMENT_REUSED", message: "この決済はすでに使用されています。" },
          { status: 409 }
        );
      }
      if (m === "ALREADY_FINALIZED") {
        // 並行リクエスト等で既に確定済み → 冪等に結果を返す
        const again = await reservationRef.get();
        const r = {
          reservationId: again.id,
          ...(again.data() as Omit<Reservation, "reservationId">),
        };
        return NextResponse.json({
          reservation: r,
          passcode: r.switchBotPasscode ?? null,
          passcodePending: r.switchBotStatus === "failed" || r.switchBotStatus === "manual",
          alreadyDone: true,
        });
      }
      throw e;
    }

    // ── SwitchBot 時限パスコード発行（暫定運用対応）──
    // 要解錠施設（決済施設＝トレーラー）は、SwitchBot未連携/発行失敗でも予約は確定し、
    // 「手動解錠対応」を管理者へ通知＋利用者に連絡待ち表示＋監査ログに記録する。
    let passcode: string | null = null;
    let passcodePending = false;
    const needsUnlock = (facility.paymentAmount ?? 0) > 0;
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
        await writeReservationAudit({
          eventType: "unlock.issued",
          reservationId: reservation.reservationId,
          facilityId: facility.id,
        });
      } catch (e) {
        // 発行失敗：手動再発行が必要。
        passcodePending = true;
        await reservationRef.update({ switchBotStatus: "failed" });
        await notifyAdmin(
          "switchbot_failed",
          `解錠コードの発行に失敗しました（予約 ${reservation.reservationId} / ${facility.name}）。手動で解錠対応/再発行してください。`,
          { reservationId: reservation.reservationId, facilityId: facility.id }
        );
        await writeReservationAudit({
          eventType: "unlock.failed",
          reservationId: reservation.reservationId,
          facilityId: facility.id,
          reason: e instanceof Error ? e.message : "SwitchBot発行失敗",
        });
        // 機密（token/secret/署名）は出さない。要約のみ。
        console.error("[reservations/complete] switchbot issue failed:", e instanceof Error ? e.message : "error");
      }
    } else if (needsUnlock) {
      // SwitchBot未連携（deviceId未設定）：手動解錠運用。予約は確定のまま。
      passcodePending = true;
      await reservationRef.update({ switchBotStatus: "manual" });
      await notifyAdmin(
        "switchbot_manual",
        `SwitchBot未連携のため解錠コードを自動発行できません。手動解錠対応が必要です（予約 ${reservation.reservationId} / ${facility.name}）。`,
        { reservationId: reservation.reservationId, facilityId: facility.id }
      );
      await writeReservationAudit({
        eventType: "unlock.manual",
        reservationId: reservation.reservationId,
        facilityId: facility.id,
        reason: "switchBotDeviceId 未設定（SwitchBot未連携）",
      });
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
    return NextResponse.json({
      reservation: { reservationId: finalSnap.id, ...finalSnap.data() },
      passcode,
      passcodePending,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[reservations/complete] POST error:", message, err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "確定処理中にエラーが発生しました" },
      { status: 500 }
    );
  }
}
