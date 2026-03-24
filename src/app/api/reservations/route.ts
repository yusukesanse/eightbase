import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { getFacilityById } from "@/lib/facilities";
import { checkAvailability, createCalendarEvent } from "@/lib/googleCalendar";
import { sendReservationConfirmed } from "@/lib/line";
import { getSessionUserId } from "@/lib/session";
import type { Reservation } from "@/types";
import dayjs from "dayjs";

export const dynamic = "force-dynamic";

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
    const { facilityId, date, startTime, endTime, displayName: bodyDisplayName } = body as {
      facilityId: string;
      date: string;
      startTime: string;
      endTime: string;
      displayName?: string;
    };

    if (!facilityId || !date || !startTime || !endTime) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const facility = getFacilityById(facilityId);
    if (!facility) {
      return NextResponse.json({ error: "Facility not found" }, { status: 404 });
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

    // Google Calendar にイベント作成
    const googleEventId = await createCalendarEvent(facility.calendarId, {
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
      createdAt: dayjs().toISOString(),
    };

    const docRef = await db.collection("reservations").add(reservationData);

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
      reservationId: docRef.id,
      message: "予約が完了しました。",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[reservations] POST error:", message, err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "予約処理中にエラーが発生しました" },
      { status: 500 }
    );
  }
}
