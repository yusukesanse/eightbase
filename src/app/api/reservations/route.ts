import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { getFacilityById } from "@/lib/facilities";
import { checkAvailability, createCalendarEvent, deleteCalendarEvent } from "@/lib/googleCalendar";
import { sendReservationConfirmed } from "@/lib/line";
import { requireActiveUser, requireProfileComplete } from "@/lib/auth";
import {
  validateReservationSlot,
  intervalsOverlap,
  timeToMin,
} from "@/lib/reservations";
// Square決済は現在無効（将来用に import は残さない）
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

// ─── GET: マイ予約一覧 ──────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const userId = await requireActiveUser(req);
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
    const userId = await requireProfileComplete(req);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
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

    // Square決済は現在無効 — paymentIdを受け付けない
    if (paymentId) {
      return NextResponse.json(
        { error: "PAYMENT_DISABLED", message: "決済機能は現在無効です。" },
        { status: 501 }
      );
    }

    if (!facilityId || !date || !startTime || !endTime) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const facility = await getFacilityById(facilityId);
    if (!facility) {
      return NextResponse.json({ error: "Facility not found" }, { status: 404 });
    }

    // 有料施設はオンライン予約不可（決済準備中）
    if (facility.requirePayment) {
      return NextResponse.json(
        { error: "PAYMENT_DISABLED", message: "オンライン決済は現在準備中です。管理者にお問い合わせください。" },
        { status: 501 }
      );
    }

    // スロット妥当性（過去日・曜日・営業時間・固定枠・利用規約）— availability と共通ルール
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

    // 二重予約防止: 直前に再度空き確認（Google Calendar は補助。最終判定は下の transaction）
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
    const reservationRef = db.collection("reservations").doc();
    let googleEventId: string | null = null;
    let lockAcquired = false;
    let reservationSaved = false;

    const reqStart = timeToMin(startTime);
    const reqEnd = timeToMin(endTime);
    await db.runTransaction(async (tx) => {
      // facilityId + date の既存ロックを読み、時間帯の重なりで判定する
      // （完全一致キーだけに依存せず、overlap するものは拒否）。
      // Admin SDK の transaction は読んだクエリ範囲をロックするため、
      // 同時実行でも overlap が二重に通らない。
      const locksSnap = await tx.get(
        db
          .collection("reservationLocks")
          .where("facilityId", "==", facilityId)
          .where("date", "==", date)
      );
      for (const lockDoc of locksSnap.docs) {
        const l = lockDoc.data();
        if (l.status === "cancelled") continue;
        if (
          typeof l.startTime === "string" &&
          typeof l.endTime === "string" &&
          intervalsOverlap(reqStart, reqEnd, timeToMin(l.startTime), timeToMin(l.endTime))
        ) {
          throw new Error("ALREADY_BOOKED");
        }
      }

      // 完全一致ロックも従来どおり拒否（保険）
      const slotDoc = await tx.get(slotRef);
      if (slotDoc.exists) {
        throw new Error("ALREADY_BOOKED");
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
        createdAt: dayjs().toISOString(),
      };

      await db.runTransaction(async (tx) => {
        tx.create(reservationRef, reservationData);
        tx.update(slotRef, {
          reservationId: reservationRef.id,
          status: "confirmed",
          updatedAt: dayjs().toISOString(),
        });
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
        await slotRef.delete().catch(() => {});
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
    console.error("[reservations] POST error:", message, err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "予約処理中にエラーが発生しました" },
      { status: 500 }
    );
  }
}
