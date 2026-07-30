import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { deleteCalendarEvent, updateCalendarEvent, createCalendarEvent } from "@/lib/googleCalendar";
import { checkAdminAuth } from "@/lib/adminAuth";
import {
  buildReservationSlotKey,
  intervalsOverlap,
  isLockBlocking,
  reservationEpochMs,
} from "@/lib/reservations";
import { timeToMin } from "@/lib/date";
import { deletePasscodeByName, issueTimeLimitPasscodeWithRetry } from "@/lib/switchbot";
import { getFacilityById } from "@/lib/facilities";
import { notifyAdmin } from "@/lib/adminNotify";
import { writeReservationAudit } from "@/lib/reservationAudit";
import { sendReservationRescheduled } from "@/lib/line";
import { FieldValue } from "firebase-admin/firestore";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

export const dynamic = "force-dynamic";

/**
 * DELETE /api/admin/reservations/[id]
 * 予約をキャンセルする（Google Calendar のイベントも削除）。
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
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
    // ⚠️ **name（予約ID）で消す**こと。switchBotKeyId は取得できていない場合がある。
    if (data.switchBotPasscode && facility?.switchBotDeviceId) {
      try {
        await deletePasscodeByName(facility.switchBotDeviceId, id);
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
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

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

    // 5) 解錠パスコードの有効期間を新しい日時へ貼り替える。
    //
    // これを忘れると「日時を動かしたのに解錠コードの窓は旧時間のまま」＝利用者が入れない。
    // SwitchBot に「キーの更新」コマンドは無いので削除→作成しかない。
    // **パスコードは同じ数字を使い回す**（利用者へ新しいコードを配り直さなくて済む）。
    //
    // ⚠️ 日時変更そのものは既に確定済み。パスコードの貼り替えに失敗しても**巻き戻さない**
    //    （予約の移動が主目的で、コードは管理画面の「再発行」で復旧できる）。
    //    ただし失敗を黙って捨てると利用者が入れないので、failed にして管理者へ通知する。
    let passcodeWarning: string | undefined;
    if (data.switchBotPasscode && facility?.switchBotDeviceId) {
      const code = data.switchBotPasscode as string;
      const newStartMs = reservationEpochMs(newDate, newStart);
      const newEndMs = reservationEpochMs(newDate, newEnd);
      try {
        // 同名キーがあると createKey は作成せず既存を返すので、必ず先に消す。
        await deletePasscodeByName(facility.switchBotDeviceId, id);
        const { keyId } = await issueTimeLimitPasscodeWithRetry({
          deviceId: facility.switchBotDeviceId,
          name: id,
          password: code, // 同じコードを使い回す
          startMs: newStartMs,
          endMs: newEndMs,
        });
        await docRef.update({
          switchBotKeyId: keyId ?? FieldValue.delete(),
          switchBotPasscodeExpiresAt: new Date(newEndMs).toISOString(),
          switchBotStatus: "issued",
        });
        await writeReservationAudit({
          eventType: "unlock.rescheduled",
          reservationId: id,
          facilityId: facility.id,
          ...(keyId === null ? { reason: "keyId 未取得（自動失効不可）" } : {}),
        });
      } catch (e) {
        await docRef.update({ switchBotStatus: "failed" }).catch(() => {});
        await notifyAdmin(
          "switchbot_failed",
          `予約日時を変更しましたが、解錠コードの有効期間の貼り替えに失敗しました（予約 ${id} / ${facility.name} / ` +
            `${newDate} ${newStart}〜${newEnd}）。利用者が入れない状態です。管理画面から再発行してください。`,
          { reservationId: id, facilityId: facility.id }
        );
        await writeReservationAudit({
          eventType: "unlock.failed",
          reservationId: id,
          facilityId: facility.id,
          reason: e instanceof Error ? e.message : "日時変更後の貼り替え失敗",
        });
        console.error(
          "[admin/reservations] passcode reschedule failed:",
          e instanceof Error ? e.message : "error"
        );
        passcodeWarning =
          "日時は変更しましたが、解錠コードの有効期間の貼り替えに失敗しました。再発行してください。";
      }
    }

    // 6) 利用者へ日時変更を通知。利用者の操作なしに予約が動くので、
    //    通知しないと変更に気づけない（解錠はできても来る時間が分からない）。
    //    ⚠️ パスコードの貼り替え(5)の後に送る。コードの扱いを本文に含めるため。
    //    通知失敗で日時変更を巻き戻さない（他の予約通知と同じ方針）。
    if (data.lineUserId) {
      try {
        await sendReservationRescheduled(data.lineUserId as string, {
          facilityName: (data.facilityName as string) ?? facility?.name ?? "",
          oldDate: data.date as string,
          oldStartTime: data.startTime as string,
          oldEndTime: data.endTime as string,
          date: newDate,
          startTime: newStart,
          endTime: newEnd,
          // 貼り替えが失敗した場合は「同じコードで使える」と案内できない
          hasPasscode: !!data.switchBotPasscode && !passcodeWarning,
        });
      } catch (err) {
        console.error("[admin/reservations] reschedule notification failed:", err);
      }
    }

    return NextResponse.json({
      success: true,
      date: newDate,
      startTime: newStart,
      endTime: newEnd,
      ...(passcodeWarning ? { passcodeWarning } : {}),
    });
  } catch (error) {
    console.error("[admin/reservations] PATCH error:", error);
    return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
  }
}
