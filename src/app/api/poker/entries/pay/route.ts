import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUserWithRole } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { gamePaymentRequired } from "@/lib/roles";
import { createReservationPaymentLink, squareErrorDetail } from "@/lib/square";
import { liffUrl } from "@/lib/liffUrl";
import { isDevLoginEnabled, isProduction } from "@/lib/env";
import { todayJst } from "@/lib/date";
import { isPokerCancelledDate } from "@/lib/pokerSchedule";
import { getPokerDayState, isPokerEntryClosed } from "@/lib/pokerDay";
import { buildPokerEntryId, isValidPokerDate } from "@/lib/pokerEntryValidation";
import { PENDING_TTL_MIN } from "@/lib/trailerPending";
import { POKER_ENTRY_FEE, type PokerEntry } from "@/types/poker";
import dayjs from "dayjs";

export const dynamic = "force-dynamic";

/**
 * POST /api/poker/entries/pay  Body: { eventDate }
 * ポーカー参加費（¥1,000）の決済リンク発行（ダーツ/ビリヤード pay を流用・Square purpose="poker"）。
 * 戻り先は /info?pokerpay=エントリーID → /api/poker/entries/complete が確定する。
 * 最初の試合の「ゲーム開始」後（pokerDayState.entryClosedAt）は支払い不可（ガード＋tx内で二重チェック）。
 */
export async function POST(req: NextRequest) {
  try {
    const [auth, season, body] = await Promise.all([
      requireGameUserWithRole(req),
      getActiveSeason("poker"),
      req.json().catch(() => null),
    ]);
    if (!auth) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    const { lineUserId: userId, role } = auth;

    if (!gamePaymentRequired(role)) {
      return NextResponse.json({ error: "PAYMENT_NOT_REQUIRED", message: "参加費のお支払いは不要です。" }, { status: 400 });
    }
    const eventDate: unknown = body?.eventDate;
    if (!isValidPokerDate(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }
    if (!season) return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });

    const db = getDb();
    const entryId = buildPokerEntryId(season.seasonId, eventDate, userId);
    const entryRef = db.collection("pokerEntries").doc(entryId);
    const entrySnap = await entryRef.get();
    if (!entrySnap.exists) {
      return NextResponse.json({ error: "NOT_ENTERED", message: "先に参加表明が必要です。" }, { status: 400 });
    }
    const entry = { ...(entrySnap.data() as PokerEntry), entryId };
    if (entry.paymentStatus === "paid") {
      return NextResponse.json({ error: "ALREADY_PAID", message: "すでにお支払い済みです。", alreadyPaid: true }, { status: 409 });
    }
    if (entry.paymentStatus === "cancelRequested") {
      return NextResponse.json({ error: "CANCEL_REQUESTED", message: "キャンセル依頼中のためお支払いできません。" }, { status: 409 });
    }
    if (await isPokerCancelledDate(eventDate)) {
      return NextResponse.json({ error: "CANCELLED_DATE", message: "この開催日は中止されました。" }, { status: 409 });
    }
    if (entry.paymentStatus === "pending" && entry.pendingExpiresAt && new Date(entry.pendingExpiresAt) > new Date()) {
      return NextResponse.json({ error: "PENDING_EXISTS", message: "お支払いリンクを発行済みです。少し時間をおいて再度お試しください。" }, { status: 409 });
    }
    if (eventDate < todayJst()) {
      return NextResponse.json({ error: "PAST_EVENT", message: "終了した開催日です。" }, { status: 400 });
    }
    if (isPokerEntryClosed(await getPokerDayState(season.seasonId, eventDate))) {
      return NextResponse.json({ error: "ENTRY_CLOSED", message: "受付は締め切られました。" }, { status: 409 });
    }

    const completePath = `/info?pokerpay=${entryId}`;
    const redirectUrl = isDevLoginEnabled()
      ? `${req.headers.get("origin") || req.nextUrl.origin}${completePath}`
      : liffUrl(completePath);
    let paymentLink: { url: string; orderId: string };
    try {
      paymentLink = await createReservationPaymentLink({
        amount: POKER_ENTRY_FEE,
        name: "ポーカーリーグ参加費",
        redirectUrl,
        purpose: "poker",
      });
    } catch (e) {
      console.error("[poker/entries/pay] payment link failed:", e);
      return NextResponse.json(
        {
          error: "PAYMENT_LINK_FAILED",
          message: isProduction() ? "決済リンクの生成に失敗しました。時間をおいてお試しください。" : `決済リンク生成に失敗: ${squareErrorDetail(e)}`,
        },
        { status: 502 }
      );
    }

    const expiresAt = dayjs().add(PENDING_TTL_MIN, "minute").toISOString();
    const dayRef = db.collection("pokerDayState").doc(`${season.seasonId}_${eventDate}`);
    try {
      await db.runTransaction(async (tx) => {
        const [freshEntry, daySnap] = await Promise.all([tx.get(entryRef), tx.get(dayRef)]);
        if (!freshEntry.exists) throw new Error("ENTRY_REMOVED");
        if (daySnap.data()?.entryClosedAt) throw new Error("ENTRY_CLOSED");
        const freshStatus = freshEntry.data()?.paymentStatus;
        if (freshStatus === "paid" || freshStatus === "cancelRequested") throw new Error("ENTRY_STATE_CHANGED");
        tx.set(
          entryRef,
          { paymentStatus: "pending", paymentAmount: POKER_ENTRY_FEE, paymentTransactionId: paymentLink.orderId, pendingExpiresAt: expiresAt },
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
    console.error("[poker/entries/pay] POST error:", message, err);
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "決済準備中にエラーが発生しました" }, { status: 500 });
  }
}
