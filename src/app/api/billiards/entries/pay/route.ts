import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUserWithRole } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { gamePaymentRequired } from "@/lib/roles";
import { createReservationPaymentLink, squareErrorDetail } from "@/lib/square";
import { liffUrl } from "@/lib/liffUrl";
import { isDevLoginEnabled, isProduction } from "@/lib/env";
import { todayJst } from "@/lib/date";
import { isBilliardsCancelledDate } from "@/lib/billiardsSchedule";
import { getBilliardsDayState, isBilliardsEntryClosed } from "@/lib/billiardsDay";
import { buildBilliardsEntryId, isValidBilliardsDate } from "@/lib/billiardsEntryValidation";
import { PENDING_TTL_MIN } from "@/lib/trailerPending";
import { BILLIARDS_ENTRY_FEE, type BilliardsEntry } from "@/types/billiards";
import dayjs from "dayjs";

export const dynamic = "force-dynamic";

/**
 * POST /api/billiards/entries/pay  Body: { eventDate }
 * ビリヤード参加費（¥1,500）の決済リンク発行（ダーツ pay を流用・Square purpose="billiards"）。
 * 戻り先は /info?billiardspay=エントリーID → /api/billiards/entries/complete が確定する。
 * GM「ゲーム開始」後（billiardsDayState.entryClosedAt）は支払い不可（ガード＋tx内で二重チェック）。
 */
export async function POST(req: NextRequest) {
  try {
    const [auth, season, body] = await Promise.all([
      requireGameUserWithRole(req),
      getActiveSeason("billiards"),
      req.json().catch(() => null),
    ]);
    if (!auth) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    const { lineUserId: userId, role } = auth;

    if (!gamePaymentRequired(role)) {
      return NextResponse.json({ error: "PAYMENT_NOT_REQUIRED", message: "参加費のお支払いは不要です。" }, { status: 400 });
    }
    const eventDate: unknown = body?.eventDate;
    if (!isValidBilliardsDate(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }
    if (!season) return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });

    const db = getDb();
    const entryId = buildBilliardsEntryId(season.seasonId, eventDate, userId);
    const entryRef = db.collection("billiardsEntries").doc(entryId);
    const entrySnap = await entryRef.get();
    if (!entrySnap.exists) {
      return NextResponse.json({ error: "NOT_ENTERED", message: "先に参加表明が必要です。" }, { status: 400 });
    }
    const entry = { ...(entrySnap.data() as BilliardsEntry), entryId };
    if (entry.paymentStatus === "paid") {
      return NextResponse.json({ error: "ALREADY_PAID", message: "すでにお支払い済みです。", alreadyPaid: true }, { status: 409 });
    }
    if (entry.paymentStatus === "cancelRequested") {
      return NextResponse.json({ error: "CANCEL_REQUESTED", message: "キャンセル依頼中のためお支払いできません。" }, { status: 409 });
    }
    if (await isBilliardsCancelledDate(eventDate)) {
      return NextResponse.json({ error: "CANCELLED_DATE", message: "この開催日は中止されました。" }, { status: 409 });
    }
    if (entry.paymentStatus === "pending" && entry.pendingExpiresAt && new Date(entry.pendingExpiresAt) > new Date()) {
      return NextResponse.json({ error: "PENDING_EXISTS", message: "お支払いリンクを発行済みです。少し時間をおいて再度お試しください。" }, { status: 409 });
    }
    if (eventDate < todayJst()) {
      return NextResponse.json({ error: "PAST_EVENT", message: "終了した開催日です。" }, { status: 400 });
    }
    if (isBilliardsEntryClosed(await getBilliardsDayState(season.seasonId, eventDate))) {
      return NextResponse.json({ error: "ENTRY_CLOSED", message: "受付は締め切られました。" }, { status: 409 });
    }

    const completePath = `/info?billiardspay=${entryId}`;
    const redirectUrl = isDevLoginEnabled()
      ? `${req.headers.get("origin") || req.nextUrl.origin}${completePath}`
      : liffUrl(completePath);
    let paymentLink: { url: string; orderId: string };
    try {
      paymentLink = await createReservationPaymentLink({
        amount: BILLIARDS_ENTRY_FEE,
        name: "ビリヤードリーグ参加費",
        redirectUrl,
        purpose: "billiards",
      });
    } catch (e) {
      console.error("[billiards/entries/pay] payment link failed:", e);
      return NextResponse.json(
        {
          error: "PAYMENT_LINK_FAILED",
          message: isProduction() ? "決済リンクの生成に失敗しました。時間をおいてお試しください。" : `決済リンク生成に失敗: ${squareErrorDetail(e)}`,
        },
        { status: 502 }
      );
    }

    const expiresAt = dayjs().add(PENDING_TTL_MIN, "minute").toISOString();
    const dayRef = db.collection("billiardsDayState").doc(`${season.seasonId}_${eventDate}`);
    try {
      await db.runTransaction(async (tx) => {
        const [freshEntry, daySnap] = await Promise.all([tx.get(entryRef), tx.get(dayRef)]);
        if (!freshEntry.exists) throw new Error("ENTRY_REMOVED");
        if (daySnap.data()?.entryClosedAt) throw new Error("ENTRY_CLOSED");
        const freshStatus = freshEntry.data()?.paymentStatus;
        if (freshStatus === "paid" || freshStatus === "cancelRequested") throw new Error("ENTRY_STATE_CHANGED");
        tx.set(
          entryRef,
          { paymentStatus: "pending", paymentAmount: BILLIARDS_ENTRY_FEE, paymentTransactionId: paymentLink.orderId, pendingExpiresAt: expiresAt },
          { merge: true }
        );
      });
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      if (code === "ENTRY_CLOSED") return NextResponse.json({ error: "ENTRY_CLOSED", message: "受付は締め切られました。" }, { status: 409 });
      if (code === "ENTRY_REMOVED" || code === "ENTRY_STATE_CHANGED") {
        return NextResponse.json({ error: "ENTRY_STATE_CHANGED", message: "参加表明の状態が変更されました。" }, { status: 409 });
      }
      throw e;
    }

    return NextResponse.json({ entryId, paymentUrl: paymentLink.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[billiards/entries/pay] POST error:", message, err);
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "決済準備中にエラーが発生しました" }, { status: 500 });
  }
}
