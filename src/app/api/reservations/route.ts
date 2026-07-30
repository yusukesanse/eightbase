import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { getFacilityById } from "@/lib/facilities";
import { checkAvailability, createCalendarEvent, deleteCalendarEvent } from "@/lib/googleCalendar";
import { sendReservationConfirmed } from "@/lib/line";
import { requireMember, requireMemberProfileComplete } from "@/lib/auth";
import {
  validateReservationSlot,
  assertSlotFreeInTx,
  buildReservationSlotKey,
} from "@/lib/reservations";
import {
  validateCompanionsForReservation,
  companionReservationFields,
  buildCompanionCalendarLines,
} from "@/lib/companions";
import type { MyReservationItem, Reservation } from "@/types";
import dayjs from "dayjs";

export const dynamic = "force-dynamic";

// ─── GET: マイ予約一覧 ──────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const userId = await requireMember(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  // NOTE: .orderBy() を使うと Firestore の複合インデックスが必要になるため
  // クエリではソートせず、取得後にメモリ上でソートする。
  // 同伴者側は array-contains に status を重ねると複合インデックスが要るので、
  // status も同様にメモリで絞る。companionIds を持たない既存予約はそもそもヒットしない。
  // 自分の予約は confirmed だけでなく **決済待ちの仮押さえ(pending_payment)も返す**。
  // ⚠️ 返さないと「決済せずに離脱した仮押さえ」が誰にも見えないまま枠を握り続け、
  //    利用者は「取り消したのに時間が選べない」状態になる（TTL 15分の自然解放を待つしかない）。
  //    status はメモリで絞る（`in` + `==` を重ねると複合インデックスが要る）。
  const [ownSnap, companionSnap] = await Promise.all([
    db
      .collection("reservations")
      .where("lineUserId", "==", userId)
      .get(),
    db
      .collection("reservations")
      .where("companionIds", "array-contains", userId)
      .get(),
  ]);

  const nowIso = dayjs().toISOString();
  const byId = new Map<string, MyReservationItem>();
  for (const doc of ownSnap.docs) {
    const data = doc.data() as Omit<Reservation, "reservationId">;
    if (data.status === "cancelled") continue;
    // 失効した仮押さえは枠を握っていない（isLockBlocking が空き扱いにする）ので出さない。
    // 有効な仮押さえだけ出す＝利用者が自分で取り消して枠を解放できる。
    if (
      data.status === "pending_payment" &&
      (!data.pendingExpiresAt || data.pendingExpiresAt <= nowIso)
    ) {
      continue;
    }
    byId.set(doc.id, { reservationId: doc.id, ...data, isCompanion: false });
  }
  for (const doc of companionSnap.docs) {
    if (byId.has(doc.id)) continue; // 予約者としても入っていれば予約者側を優先
    const data = doc.data() as Omit<Reservation, "reservationId">;
    if (data.status !== "confirmed") continue;
    // 同伴者には解錠コードと決済情報を渡さない（単独解錠・決済照会を防ぐ）
    const {
      switchBotPasscode: _passcode,
      switchBotKeyId: _keyId,
      switchBotPasscodeExpiresAt: _passcodeExpiresAt,
      switchBotStatus: _switchBotStatus,
      paymentId: _paymentId,
      paymentTransactionId: _paymentTransactionId,
      ...safe
    } = data;
    byId.set(doc.id, { reservationId: doc.id, ...safe, isCompanion: true });
  }

  const reservations: MyReservationItem[] = Array.from(byId.values()).sort((a, b) => {
    // 日付 → 開始時刻 の昇順
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.startTime.localeCompare(b.startTime);
  });

  return NextResponse.json({ reservations });
}

// ─── POST: 予約登録 ────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const userId = await requireMemberProfileComplete(req);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const body = await req.json();
    const {
      facilityId, date, startTime, endTime,
      displayName: bodyDisplayName, termsAgreed,
      paymentId, companionIds,
    } = body as {
      facilityId: string;
      date: string;
      startTime: string;
      endTime: string;
      displayName?: string;
      termsAgreed?: boolean;
      paymentId?: string;
      companionIds?: unknown;
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

    const db = getDb();

    // 同伴者（サウナ等・1人での利用を禁止する施設）。Google Calendar を叩く前に弾く。
    // 同伴者必須OFFの施設かつ同伴者なしなら Firestore には触れない。
    const companionResult = await validateCompanionsForReservation(
      db,
      facility,
      userId,
      companionIds
    );
    if (!companionResult.ok) {
      return NextResponse.json(
        {
          error: companionResult.reason,
          message: companionResult.message,
          ...(companionResult.invalidIds ? { invalidIds: companionResult.invalidIds } : {}),
        },
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

    const nowIso = dayjs().toISOString();
    await db.runTransaction(async (tx) => {
      // 空き判定はロック共通ヘルパーに集約（失効pendingのTTL解放含めて pending経路と一本化）。
      await assertSlotFreeInTx(tx, db, { facilityId, date, startTime, endTime, nowIso });
      // 失効した pending ロックは上書き再取得できるよう set を使う。
      tx.set(slotRef, {
        facilityId,
        date,
        startTime,
        endTime,
        status: "pending",
        lineUserId: userId,
        createdAt: nowIso,
      });
    });
    lockAcquired = true;

    try {
      // Google Calendar にイベント作成
      googleEventId = await createCalendarEvent(facility.calendarId, {
        date,
        startTime,
        endTime,
        summary:
          `${facility.name} - ${user.displayName}` +
          (companionResult.companions.length ? `（他${companionResult.companions.length}名）` : ""),
        description:
          `予約者: ${user.displayName}\nテナント: ${user.tenantName}\nLINE ID: ${userId}` +
          buildCompanionCalendarLines(companionResult.companions, companionResult.partySize),
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
        // 同伴者なしのときは1フィールドも足さない（既存予約と doc の形状を完全に一致させる）
        ...companionReservationFields(companionResult, user.displayName),
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
