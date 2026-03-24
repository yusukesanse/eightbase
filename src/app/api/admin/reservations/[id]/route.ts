import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { deleteCalendarEvent } from "@/lib/googleCalendar";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN;

function checkAdminAuth(req: NextRequest): boolean {
  if (!ADMIN_TOKEN) return false;
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${ADMIN_TOKEN}`;
}

/**
 * DELETE /api/admin/reservations/[id]
 * 予約をキャンセルする（Google Calendar のイベントも削除）。
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: "id は必須です" }, { status: 400 });
  }

  try {
    const db = getDb();
    const docRef = db.collection("reservations").doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return NextResponse.json({ error: "予約が見つかりません" }, { status: 404 });
    }

    const data = doc.data()!;

    // Google Calendar のイベントを削除（失敗してもFirestoreは更新する）
    if (data.googleEventId) {
      try {
        const { getFacilityById } = await import("@/lib/facilities");
        const facility = getFacilityById(data.facilityId);
        if (facility) {
          await deleteCalendarEvent(facility.calendarId, data.googleEventId);
        }
      } catch (calErr) {
        console.error("[admin/reservations] Calendar delete error:", calErr);
      }
    }

    await docRef.update({ status: "cancelled", cancelledAt: new Date().toISOString() });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/reservations] DELETE error:", error);
    return NextResponse.json({ error: "キャンセルに失敗しました" }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/reservations/[id]
 * 予約の日時を変更する。
 * Body: { date?, startTime?, endTime? }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = params;

  try {
    const body = await req.json();
    const { date, startTime, endTime } = body;

    if (!date && !startTime && !endTime) {
      return NextResponse.json({ error: "変更する項目を指定してください" }, { status: 400 });
    }

    const db = getDb();
    const docRef = db.collection("reservations").doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return NextResponse.json({ error: "予約が見つかりません" }, { status: 404 });
    }

    const updates: Record<string, string> = {};
    if (date) updates.date = date;
    if (startTime) updates.startTime = startTime;
    if (endTime) updates.endTime = endTime;

    await docRef.update(updates);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/reservations] PATCH error:", error);
    return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
  }
}
