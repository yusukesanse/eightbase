import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { getFacilityById } from "@/lib/facilities";
import { checkAvailability, createCalendarEvent } from "@/lib/googleCalendar";
import { sendReservationConfirmed } from "@/lib/line";
import type { Reservation } from "@/types";
import dayjs from "dayjs";

// ─── GET: マイ予約一覧 ──────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const userId = req.headers.get("x-line-user-id");
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const snap = await db
    .collection("reservations")
    .where("lineUserId", "==", userId)
    .where("status", "==", "confirmed")
    .orderBy("date", "asc")
    .get();

  const reservations: Reservation[] = snap.docs.map((doc) => ({
    reservationId: doc.id,
    ...(doc.data() as Omit<Reservation, "reservationId">),
  }));

  return NextResponse.json({ reservations });
}

// ─── POST: 予約登録 ────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const userId = req.headers.get("x-line-user-id");
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { facilityId, date, startTime, endTime } = body as {
    facilityId: string;
    date: string;
    startTime: string;
    endTime: string;
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

  // Firestore からユーザー情報取得
  const db = getDb();
  const userDoc = await db.collection("users").doc(userId).get();
  if (!userDoc.exists) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const user = userDoc.data()!;

  // Google Calendar にイベント作成
  const googleEventId = await createCalendarEvent(facility.calendarId, {
    date,
    startTime,
    endTime,
    summary: `【NUF】${facility.name} — ${user.displayName}（${user.tenantName}）`,
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
    console.error("LINE notification failed:", err);
  }

  return NextResponse.json({
    reservationId: docRef.id,
    message: "予約が完了しました。",
  });
}
