import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { deleteCalendarEvent, updateCalendarEvent, createCalendarEvent } from "@/lib/googleCalendar";
import { checkAdminAuth } from "@/lib/adminAuth";
import {
  buildReservationSlotKey,
  intervalsOverlap,
  isLockBlocking,
  timeToMin,
} from "@/lib/reservations";
import { deletePasscode } from "@/lib/switchbot";
import { getFacilityById } from "@/lib/facilities";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

export const dynamic = "force-dynamic";

/**
 * DELETE /api/admin/reservations/[id]
 * 予約をキャンセルする（Google Calendar のイベントも削除）。
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!(await checkAdminAuth(req))) {
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
    const facility = await getFacilityById(data.facilityId);

    // Google Calendar のイベントを削除（失敗してもFirestoreは更新する）
    if (data.googleEventId && facility) {
      try {
        await deleteCalendarEvent(facility.calendarId, data.googleEventId);
      } catch (calErr) {
        console.error("[admin/reservations] Calendar delete error:", calErr);
      }
    }

    const slotRef = db
      .collection("reservationLocks")
      .doc(buildReservationSlotKey(
        data.facilityId,
        data.date,
        data.startTime,
        data.endTime
      ));
    await db.runTransaction(async (tx) => {
      tx.update(docRef, { status: "cancelled", cancelledAt: new Date().toISOString() });
      tx.delete(slotRef);
    });

    // トレーラー等: 管理者キャンセルでも解錠コードを即時無効化（残存させない）。
    if (data.switchBotKeyId && facility?.switchBotDeviceId) {
      try {
        await deletePasscode(facility.switchBotDeviceId, data.switchBotKeyId as number);
      } catch (err) {
        console.error("[admin/reservations] passcode revoke failed:", err);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/reservations] DELETE error:", error);
    return NextResponse.json({ error: "キャンセルに失敗しました" }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/reservations/[id]
 * 予約の日時を変更する。Firestore(予約 + reservationLocks) を真実の源として:
 *  1. 新スロットの空きを transaction で再検証（自分の旧ロックは除外）
 *  2. 旧 reservationLocks を削除し、新しい日時の confirmed ロックを作成（原子的）
 *  3. 予約レコードを更新
 * その後 Google Calendar を新しい時間帯へ追随（patch / 無ければ create）。
 * GCal 更新に失敗したら Firestore を旧状態へ巻き戻し、不整合を残さない。
 * Body: { date?, startTime?, endTime? }（施設は変更しない）
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = params;

  try {
    const body = await req.json();
    const { date, startTime, endTime } = body as {
      date?: string;
      startTime?: string;
      endTime?: string;
    };

    if (!date && !startTime && !endTime) {
      return NextResponse.json({ error: "変更する項目を指定してください" }, { status: 400 });
    }

    const db = getDb();
    const docRef = db.collection("reservations").doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
      return NextResponse.json({ error: "予約が見つかりません" }, { status: 404 });
    }
    const data = doc.data()!;
    if (data.status !== "confirmed") {
      return NextResponse.json({ error: "確定済みの予約のみ日時を変更できます" }, { status: 409 });
    }

    // 現在値とマージ（施設は不変）。
    const newDate = date ?? data.date;
    const newStart = startTime ?? data.startTime;
    const newEnd = endTime ?? data.endTime;

    if (!DATE_RE.test(newDate) || !TIME_RE.test(newStart) || !TIME_RE.test(newEnd)) {
      return NextResponse.json({ error: "日付・時刻の形式が不正です" }, { status: 400 });
    }
    if (timeToMin(newEnd) <= timeToMin(newStart)) {
      return NextResponse.json({ error: "終了時刻は開始時刻より後にしてください" }, { status: 400 });
    }

    const facilityId: string = data.facilityId;
    const oldKey = buildReservationSlotKey(facilityId, data.date, data.startTime, data.endTime);
    const newKey = buildReservationSlotKey(facilityId, newDate, newStart, newEnd);

    // 変更なし（同一スロット）ならそのまま成功。
    if (oldKey === newKey) {
      return NextResponse.json({ success: true, date: newDate, startTime: newStart, endTime: newEnd });
    }

    const facility = await getFacilityById(facilityId);
    const nowIso = new Date().toISOString();
    const oldSlotRef = db.collection("reservationLocks").doc(oldKey);
    const newSlotRef = db.collection("reservationLocks").doc(newKey);

    // 1〜3) 空き再検証 → ロック付け替え → 予約更新 を1トランザクションで原子化。
    try {
      await db.runTransaction(async (tx) => {
        // 新しい日の全ロックを読み、時間帯が重なるブロッキングロックがあれば拒否（自分の旧ロックは除外）。
        const locksSnap = await tx.get(
          db.collection("reservationLocks").where("facilityId", "==", facilityId).where("date", "==", newDate)
        );
        const reqStart = timeToMin(newStart);
        const reqEnd = timeToMin(newEnd);
        for (const lockDoc of locksSnap.docs) {
          if (lockDoc.id === oldKey) continue; // 移動元の自分のロックは重複対象にしない
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
        const oldLockSnap = await tx.get(oldSlotRef);
        const oldLock = oldLockSnap.exists ? (oldLockSnap.data() ?? {}) : {};

        tx.delete(oldSlotRef);
        tx.set(newSlotRef, {
          facilityId,
          date: newDate,
          startTime: newStart,
          endTime: newEnd,
          status: "confirmed",
          reservationId: id,
          lineUserId: oldLock.lineUserId ?? data.lineUserId ?? null,
          createdAt: oldLock.createdAt ?? nowIso,
          updatedAt: nowIso,
        });
        tx.update(docRef, { date: newDate, startTime: newStart, endTime: newEnd, updatedAt: nowIso });
      });
    } catch (txErr) {
      if (txErr instanceof Error && txErr.message === "ALREADY_BOOKED") {
        return NextResponse.json(
          { error: "ALREADY_BOOKED", message: "変更先の時間帯はすでに予約済みです。" },
          { status: 409 }
        );
      }
      throw txErr;
    }

    // 4) Google Calendar を新しい時間帯へ追随。失敗したら Firestore を旧状態へ巻き戻す。
    if (facility) {
      try {
        if (data.googleEventId) {
          await updateCalendarEvent(facility.calendarId, data.googleEventId, {
            date: newDate,
            startTime: newStart,
            endTime: newEnd,
          });
        } else {
          // 確定予約なのに GCal イベントが無い → 作成して ID を保存。
          const newEventId = await createCalendarEvent(facility.calendarId, {
            date: newDate,
            startTime: newStart,
            endTime: newEnd,
            summary: `${facility.name}`,
            description: `LINE ID: ${data.lineUserId ?? ""}`,
          });
          await docRef.update({ googleEventId: newEventId });
        }
      } catch (calErr) {
        console.error("[admin/reservations] Calendar update error:", calErr);
        // 補償: ロックと予約を旧状態へ戻す（GCal は未変更のまま＝旧時間で整合）。
        await db
          .runTransaction(async (tx) => {
            tx.delete(newSlotRef);
            tx.set(oldSlotRef, {
              facilityId,
              date: data.date,
              startTime: data.startTime,
              endTime: data.endTime,
              status: "confirmed",
              reservationId: id,
              lineUserId: data.lineUserId ?? null,
              updatedAt: nowIso,
            });
            tx.update(docRef, {
              date: data.date,
              startTime: data.startTime,
              endTime: data.endTime,
              updatedAt: nowIso,
            });
          })
          .catch((revErr) => console.error("[admin/reservations] revert failed:", revErr));
        return NextResponse.json(
          { error: "CALENDAR_UPDATE_FAILED", message: "カレンダー更新に失敗したため変更を取り消しました。時間をおいて再度お試しください。" },
          { status: 502 }
        );
      }
    }

    return NextResponse.json({ success: true, date: newDate, startTime: newStart, endTime: newEnd });
  } catch (error) {
    console.error("[admin/reservations] PATCH error:", error);
    return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
  }
}
