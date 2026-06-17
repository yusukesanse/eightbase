import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { getFacilityById } from "@/lib/facilities";
import { checkAvailability, createCalendarEvent, deleteCalendarEvent } from "@/lib/googleCalendar";
import { sendReservationConfirmed } from "@/lib/line";
import { getSessionUserId } from "@/lib/session";
import { calculateReservationAmount, verifySquarePayment } from "@/lib/square";
import type { Reservation } from "@/types";
import dayjs from "dayjs";

export const dynamic = "force-dynamic";

function buildReservationSlotKey(
  facilityId: string,
  date: string,
  startTime: string,
  endTime: string
): string {
  return encodeURIComponent(`${facilityId}_${date}_${startTime}_${endTime}`);
}

function buildPaymentKey(paymentId: string): string {
  return encodeURIComponent(paymentId);
}

// ─── GET: マイ予約一覧 ──────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const userId = await getSessionUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  // NOTE: .orderBy() を使うと Firestore の複合インデックスが必要になるため
  // クエリではソートせず、取得後にメモリ上でソートする。
  const snap = await db
    .collection("reservations")
    .where("lineUserId", "==", userId)
    .where("status", "==", "confirmed")
    .get();

  const reservations: Reservation[] = snap.docs
    .map((doc) => ({
      reservationId: doc.id,
      ...(doc.data() as Omit<Reservation, "reservationId">),
    }))
    .sort((a, b) => {
      // 日付 → 開始時刻 の昇順
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.startTime.localeCompare(b.startTime);
    });

  return NextResponse.json({ reservations });
}

// ─── POST: 予約登録 ────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const userId = await getSessionUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const {
      facilityId, date, startTime, endTime,
      displayName: bodyDisplayName, termsAgreed,
      paymentId,
    } = body as {
      facilityId: string;
      date: string;
      startTime: string;
      endTime: string;
      displayName?: string;
      termsAgreed?: boolean;
      paymentId?: string;
    };

    if (!facilityId || !date || !startTime || !endTime) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const facility = await getFacilityById(facilityId);
    if (!facility) {
      return NextResponse.json({ error: "Facility not found" }, { status: 404 });
    }

    const expectedPaymentAmount = calculateReservationAmount(facility, startTime, endTime);
    if (facility.requirePayment) {
      if (!paymentId) {
        return NextResponse.json(
          { error: "PAYMENT_REQUIRED", message: "この施設は決済が必要です。" },
          { status: 402 }
        );
      }
      try {
        await verifySquarePayment({
          paymentId,
          expectedAmount: expectedPaymentAmount,
          userId,
        });
      } catch (error) {
        return NextResponse.json(
          {
            error: "INVALID_PAYMENT",
            message: error instanceof Error ? error.message : "決済情報を確認できませんでした。",
          },
          { status: 402 }
        );
      }
    }

    // 二重予約防止: 直前に再度空き確認
    const available = await checkAvailability(
      facility.calendarId,
      date,
      startTime,
      endTime
    );
    if (!available) {
      return NextResponse.json(
        { error: "ALREADY_BOOKED", message: "この時間帯はすでに予約済みです。" },
        { status: 409 }
      );
    }

    // Firestore からユーザー情報取得（存在しない場合は自動作成）
    const db = getDb();
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();
    let user: { displayName: string; tenantName: string };
    if (!userDoc.exists) {
      user = {
        displayName: bodyDisplayName ?? userId,
        tenantName: "",
      };
      await userRef.set({
        ...user,
        lineUserId: userId,
        createdAt: dayjs().toISOString(),
      });
    } else {
      const data = userDoc.data()!;
      user = {
        displayName: data.displayName ?? bodyDisplayName ?? userId,
        tenantName: data.tenantName ?? "",
      };
    }

    const slotKey = buildReservationSlotKey(facilityId, date, startTime, endTime);
    const slotRef = db.collection("reservationLocks").doc(slotKey);
    const paymentRef = paymentId
      ? db.collection("usedPayments").doc(buildPaymentKey(paymentId))
      : null;
    const reservationRef = db.collection("reservations").doc();
    let googleEventId: string | null = null;
    let lockAcquired = false;
    let reservationSaved = false;

    await db.runTransaction(async (tx) => {
      const slotDoc = await tx.get(slotRef);
      if (slotDoc.exists) {
        throw new Error("ALREADY_BOOKED");
      }
      if (paymentRef) {
        const paymentDoc = await tx.get(paymentRef);
        if (paymentDoc.exists) {
          throw new Error("PAYMENT_ALREADY_USED");
        }
      }

      tx.create(slotRef, {
        facilityId,
        date,
        startTime,
        endTime,
        status: "pending",
        lineUserId: userId,
        createdAt: dayjs().toISOString(),
      });
      if (paymentRef && paymentId) {
        tx.create(paymentRef, {
          paymentId,
          lineUserId: userId,
          amount: expectedPaymentAmount,
          status: "pending",
          createdAt: dayjs().toISOString(),
        });
      }
    });
    lockAcquired = true;

    try {
      // Google Calendar にイベント作成
      googleEventId = await createCalendarEvent(facility.calendarId, {
        date,
        startTime,
        endTime,
        summary: `${facility.name} - ${user.displayName}`,
        description: `予約者: ${user.displayName}\nテナント: ${user.tenantName}\nLINE ID: ${userId}`,
      });

      // Firestore に予約レコードを保存
      const reservationData: Omit<Reservation, "reservationId"> = {
        facilityId,
        facilityName: facility.name,
        lineUserId: userId,
        date,
        startTime,
        endTime,
        googleEventId,
        status: "confirmed",
        ...(termsAgreed ? { termsAgreed: true, termsAgreedAt: dayjs().toISOString() } : {}),
        ...(paymentId ? {
          paymentId,
          paymentAmount: expectedPaymentAmount,
          paymentStatus: "completed" as const,
        } : {}),
        createdAt: dayjs().toISOString(),
      };

      await db.runTransaction(async (tx) => {
        tx.create(reservationRef, reservationData);
        tx.update(slotRef, {
          reservationId: reservationRef.id,
          status: "confirmed",
          updatedAt: dayjs().toISOString(),
        });
        if (paymentRef) {
          tx.update(paymentRef, {
            reservationId: reservationRef.id,
            status: "used",
            usedAt: dayjs().toISOString(),
          });
        }
      });
      reservationSaved = true;
    } catch (error) {
      if (googleEventId) {
        try {
          await deleteCalendarEvent(facility.calendarId, googleEventId);
        } catch (deleteError) {
          console.error("[reservations] Calendar compensation failed:", deleteError);
        }
      }
      if (lockAcquired && !reservationSaved) {
        await Promise.allSettled([
          slotRef.delete(),
          paymentRef?.delete() ?? Promise.resolve(),
        ]);
      }
      if (paymentId) {
        await db.collection("pendingPayments").add({
          paymentId,
          lineUserId: userId,
          amount: expectedPaymentAmount,
          facilityId,
          date,
          startTime,
          endTime,
          reason: error instanceof Error ? error.message : String(error),
          createdAt: dayjs().toISOString(),
        });
      }
      throw error;
    }

    // LINE 通知送信（失敗しても予約自体は成功とする）
    try {
      await sendReservationConfirmed(userId, {
        facilityName: facility.name,
        date,
        startTime,
        endTime,
        displayName: user.displayName,
      });
    } catch (err) {
      console.error("[reservations] LINE notification failed:", err);
    }

    return NextResponse.json({
      reservationId: reservationRef.id,
      message: "予約が完了しました。",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "ALREADY_BOOKED") {
      return NextResponse.json(
        { error: "ALREADY_BOOKED", message: "この時間帯はすでに予約済みです。" },
        { status: 409 }
      );
    }
    if (message === "PAYMENT_ALREADY_USED") {
      return NextResponse.json(
        { error: "PAYMENT_ALREADY_USED", message: "この決済はすでに使用されています。" },
        { status: 409 }
      );
    }
    console.error("[reservations] POST error:", message, err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "予約処理中にエラーが発生しました" },
      { status: 500 }
    );
  }
}
