import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { getFacilityById } from "@/lib/facilities";
import { requireProfileComplete } from "@/lib/auth";
import {
  validateReservationSlot,
  intervalsOverlap,
  timeToMin,
  isLockBlocking,
} from "@/lib/reservations";
import {
  signPendingCookie,
  PENDING_RESERVATION_COOKIE,
  PENDING_TTL_MIN,
} from "@/lib/trailerPending";
import type { Reservation } from "@/types";
import dayjs from "dayjs";

export const dynamic = "force-dynamic";

/**
 * POST /api/reservations/pending
 * トレーラー等（squarePaymentUrl 設定施設）の「決済前 仮押さえ」。
 *  - pending_payment 予約 ＋ TTL付きロックを transaction で作成（二重予約防止）
 *  - reservationId を署名Cookieに入れ、決済URL(squarePaymentUrl)を返す
 *  - 決済はクライアントがこのURLへ遷移し、戻りは /reservation/complete で確定する
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireProfileComplete(req);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const body = await req.json();
    const { facilityId, date, startTime, endTime, termsAgreed } = body as {
      facilityId: string;
      date: string;
      startTime: string;
      endTime: string;
      termsAgreed?: boolean;
    };

    if (!facilityId || !date || !startTime || !endTime) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const facility = await getFacilityById(facilityId);
    if (!facility) {
      return NextResponse.json({ error: "Facility not found" }, { status: 404 });
    }
    // この経路は決済URLが設定された施設専用
    if (!facility.squarePaymentUrl) {
      return NextResponse.json(
        { error: "NOT_PAYMENT_FACILITY", message: "この施設は決済予約に対応していません。" },
        { status: 400 }
      );
    }

    const slotValidation = validateReservationSlot(facility, {
      date,
      startTime,
      endTime,
      termsAgreed,
      enforceTerms: true,
    });
    if (!slotValidation.ok) {
      return NextResponse.json(
        { error: slotValidation.reason, message: slotValidation.message },
        { status: 400 }
      );
    }

    const db = getDb();
    const nowIso = dayjs().toISOString();
    const expiresAt = dayjs().add(PENDING_TTL_MIN, "minute").toISOString();
    const reqStart = timeToMin(startTime);
    const reqEnd = timeToMin(endTime);
    const slotKey = encodeURIComponent(`${facilityId}_${date}_${startTime}_${endTime}`);
    const slotRef = db.collection("reservationLocks").doc(slotKey);
    const reservationRef = db.collection("reservations").doc();

    await db.runTransaction(async (tx) => {
      // facilityId + date の既存ロックを読み、ブロッキング（confirmed / 未失効pending）かつ
      // 時間帯が重なるものがあれば拒否。失効した pending（TTL超過）は空き扱い。
      const locksSnap = await tx.get(
        db
          .collection("reservationLocks")
          .where("facilityId", "==", facilityId)
          .where("date", "==", date)
      );
      for (const lockDoc of locksSnap.docs) {
        const l = lockDoc.data();
        if (!isLockBlocking(l, nowIso)) continue;
        if (
          typeof l.startTime === "string" &&
          typeof l.endTime === "string" &&
          intervalsOverlap(reqStart, reqEnd, timeToMin(l.startTime), timeToMin(l.endTime))
        ) {
          throw new Error("ALREADY_BOOKED");
        }
      }
      // 完全一致キーの既存ロックがブロッキングなら拒否（失効pendingは上書き再取得）。
      const slotDoc = await tx.get(slotRef);
      if (slotDoc.exists && isLockBlocking(slotDoc.data() ?? {}, nowIso)) {
        throw new Error("ALREADY_BOOKED");
      }

      tx.set(slotRef, {
        facilityId,
        date,
        startTime,
        endTime,
        status: "pending",
        lineUserId: userId,
        pendingExpiresAt: expiresAt,
        reservationId: reservationRef.id,
        createdAt: nowIso,
      });

      const reservationData: Omit<Reservation, "reservationId"> = {
        facilityId,
        facilityName: facility.name,
        lineUserId: userId,
        date,
        startTime,
        endTime,
        googleEventId: "",
        status: "pending_payment",
        pendingExpiresAt: expiresAt,
        ...(facility.paymentAmount ? { paymentAmount: facility.paymentAmount } : {}),
        ...(termsAgreed ? { termsAgreed: true, termsAgreedAt: nowIso } : {}),
        createdAt: nowIso,
      };
      tx.create(reservationRef, reservationData);
    });

    const res = NextResponse.json({
      reservationId: reservationRef.id,
      paymentUrl: facility.squarePaymentUrl,
    });
    const cookie = await signPendingCookie(reservationRef.id, userId);
    res.cookies.set(PENDING_RESERVATION_COOKIE, cookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: PENDING_TTL_MIN * 60,
      path: "/",
    });
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "ALREADY_BOOKED") {
      return NextResponse.json(
        { error: "ALREADY_BOOKED", message: "この時間帯はすでに予約済みです。" },
        { status: 409 }
      );
    }
    console.error("[reservations/pending] POST error:", message, err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "仮押さえ処理中にエラーが発生しました" },
      { status: 500 }
    );
  }
}
