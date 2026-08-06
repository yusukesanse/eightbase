import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { getFacilityById } from "@/lib/facilities";
import { requireMemberProfileComplete } from "@/lib/auth";
import {
  validateReservationSlot,
  assertSlotFreeInTx,
  buildReservationSlotKey,
} from "@/lib/reservations";
import { assertCalendarSlotFree } from "@/lib/calendarBusy";
import { createReservationPaymentLink } from "@/lib/square";
import { getFacilitySquareCredentials } from "@/lib/facilitySecrets";
import { liffUrl } from "@/lib/liffUrl";
import { isDevLoginEnabled } from "@/lib/env";
import { PENDING_TTL_MIN } from "@/lib/trailerPending";
import {
  validateCompanionsForReservation,
  companionReservationFields,
} from "@/lib/companions";
import type { Reservation } from "@/types";
import dayjs from "dayjs";

export const dynamic = "force-dynamic";

/**
 * POST /api/reservations/pending
 * 決済が必要な施設（paymentAmount 設定）の「決済前 仮押さえ」。
 *  - pending_payment 予約 ＋ TTL付きロックを transaction で作成（二重予約防止）
 *  - 予約ごとの Square 決済リンクを生成（redirect_url に `?rid=予約ID` を埋め込む）
 *  - 生成注文ID(orderId)を予約に保存し、決済URLを返す
 *  - 決済はクライアントがこのURLへ遷移し、戻りは /reservation/complete?rid=... で確定する
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireMemberProfileComplete(req);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const body = await req.json();
    const { facilityId, date, startTime, endTime, termsAgreed, companionIds } = body as {
      facilityId: string;
      date: string;
      startTime: string;
      endTime: string;
      termsAgreed?: boolean;
      companionIds?: unknown;
    };

    if (!facilityId || !date || !startTime || !endTime) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const facility = await getFacilityById(facilityId);
    if (!facility) {
      return NextResponse.json({ error: "Facility not found" }, { status: 404 });
    }
    // この経路は決済額が設定された施設専用
    if (!facility.paymentAmount || facility.paymentAmount <= 0) {
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

    // 同伴者（サウナ等）。Square 決済リンクを作る前に弾く。
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

    // GCal に人が直接入れた予定（＝アプリを通さない手動予約）と重なっていないか。
    // ⚠️ この経路は以前 GCal を一切見ておらず、カレンダーから入れたトレーラーの予約があっても
    //    ミニアプリから予約できてしまっていた（2026-08-06 修正）。決済リンクを作る前・transaction の外で確認する。
    await assertCalendarSlotFree(facility.calendarId, { date, startTime, endTime });

    const nowIso = dayjs().toISOString();
    const expiresAt = dayjs().add(PENDING_TTL_MIN, "minute").toISOString();
    const slotRef = db
      .collection("reservationLocks")
      .doc(buildReservationSlotKey(facilityId, date, startTime, endTime));
    const reservationRef = db.collection("reservations").doc();

    // 予約専用の Square 決済リンクを生成（戻り先URLに予約IDを埋め込む）。
    // 失敗時は仮押さえを作る前に中断（不要なpendingロックを残さない）。
    //
    // 戻り先は LINEミニアプリ(LIFF)へ戻すため LIFF URL を使う（決済後にミニアプリ内へ復帰）。
    // ただし demo のブラウザ検証（Dev ログイン時）は LIFF を開けないので Web URL にする。
    const completePath = `/reservation/complete?rid=${reservationRef.id}`;
    const redirectUrl = isDevLoginEnabled()
      ? `${req.headers.get("origin") || req.nextUrl.origin}${completePath}`
      : liffUrl(completePath);
    let paymentLink: { url: string; orderId: string };
    try {
      // 施設ごとのSquare認証情報（未登録なら環境変数 SQUARE_* にフォールバック）
      const squareCredentials = (await getFacilitySquareCredentials(facility.id)) ?? undefined;
      paymentLink = await createReservationPaymentLink({
        amount: facility.paymentAmount,
        name: facility.name,
        redirectUrl,
        credentials: squareCredentials,
      });
    } catch (e) {
      console.error("[reservations/pending] payment link failed:", e);
      return NextResponse.json(
        { error: "PAYMENT_LINK_FAILED", message: "決済リンクの生成に失敗しました。時間をおいてお試しください。" },
        { status: 502 }
      );
    }

    await db.runTransaction(async (tx) => {
      // 空き判定はロック共通ヘルパーに集約（通常POSTと同一ルール／失効pendingのTTL解放含む）。
      await assertSlotFreeInTx(tx, db, { facilityId, date, startTime, endTime, nowIso });

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
        // 決済後の照合に使う注文ID（この予約専用リンクの注文）
        paymentTransactionId: paymentLink.orderId,
        paymentAmount: facility.paymentAmount,
        ...(termsAgreed ? { termsAgreed: true, termsAgreedAt: nowIso } : {}),
        // 同伴者なしのときは1フィールドも足さない（既存予約と doc の形状を完全に一致させる）
        ...companionReservationFields(companionResult),
        createdAt: nowIso,
      };
      tx.create(reservationRef, reservationData);
    });

    return NextResponse.json({
      reservationId: reservationRef.id,
      paymentUrl: paymentLink.url,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "ALREADY_BOOKED") {
      return NextResponse.json(
        { error: "ALREADY_BOOKED", message: "この時間帯はすでに予約済みです。" },
        { status: 409 }
      );
    }
    // GCal を確認できないときは仮押さえも作らない（決済させてから重複が判明する事故を防ぐ）。
    if (message === "CALENDAR_UNAVAILABLE") {
      return NextResponse.json(
        {
          error: "CALENDAR_UNAVAILABLE",
          message: "空き状況を確認できませんでした。時間をおいてお試しください。",
        },
        { status: 503 }
      );
    }
    console.error("[reservations/pending] POST error:", message, err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "仮押さえ処理中にエラーが発生しました" },
      { status: 500 }
    );
  }
}
