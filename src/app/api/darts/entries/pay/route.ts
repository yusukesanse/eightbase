import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUserWithRole } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { gamePaymentRequired } from "@/lib/roles";
import { createReservationPaymentLink, squareErrorDetail } from "@/lib/square";
import { liffUrl } from "@/lib/liffUrl";
import { isDevLoginEnabled, isProduction } from "@/lib/env";
import { todayJst } from "@/lib/date";
import { isDartsCancelledDate } from "@/lib/dartsSchedule";
import { getDartsDayState, isDartsEntryClosed } from "@/lib/dartsDay";
import { buildDartsEntryId, isValidDartsDate } from "@/lib/dartsEntryValidation";
import { PENDING_TTL_MIN } from "@/lib/trailerPending";
import { DARTS_ENTRY_FEE, type DartsEntry } from "@/types/darts";
import dayjs from "dayjs";

export const dynamic = "force-dynamic";

/**
 * POST /api/darts/entries/pay  Body: { eventDate }
 * ダーツ参加費（¥1,000）の決済リンク発行（麻雀 pay を流用・Square purpose="darts"）。
 * 戻り先は /info?dartspay=エントリーID → /api/darts/entries/complete が確定する。
 * GM「ゲーム開始」後（dartsDayState.entryClosedAt）は支払い不可（下記ガード＋tx内で二重チェック）。
 */
export async function POST(req: NextRequest) {
  try {
    const [auth, season, body] = await Promise.all([
      requireGameUserWithRole(req),
      getActiveSeason("darts"),
      req.json().catch(() => null),
    ]);
    if (!auth) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    const { lineUserId: userId, role } = auth;

    if (!gamePaymentRequired(role)) {
      return NextResponse.json(
        { error: "PAYMENT_NOT_REQUIRED", message: "参加費のお支払いは不要です。" },
        { status: 400 }
      );
    }

    const eventDate: unknown = body?.eventDate;
    if (!isValidDartsDate(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }
    if (!season) {
      return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });
    }

    const db = getDb();
    const entryId = buildDartsEntryId(season.seasonId, eventDate, userId);
    const entryRef = db.collection("dartsEntries").doc(entryId);
    const entrySnap = await entryRef.get();
    if (!entrySnap.exists) {
      return NextResponse.json(
        { error: "NOT_ENTERED", message: "先に参加表明が必要です。" },
        { status: 400 }
      );
    }
    const entry = { ...(entrySnap.data() as DartsEntry), entryId };
    if (entry.paymentStatus === "paid") {
      return NextResponse.json(
        { error: "ALREADY_PAID", message: "すでにお支払い済みです。", alreadyPaid: true },
        { status: 409 }
      );
    }
    if (entry.paymentStatus === "cancelRequested") {
      return NextResponse.json(
        { error: "CANCEL_REQUESTED", message: "キャンセル依頼中のためお支払いできません。" },
        { status: 409 }
      );
    }
    if (await isDartsCancelledDate(eventDate)) {
      return NextResponse.json(
        { error: "CANCELLED_DATE", message: "この開催日は中止されました。" },
        { status: 409 }
      );
    }
    if (
      entry.paymentStatus === "pending" &&
      entry.pendingExpiresAt &&
      new Date(entry.pendingExpiresAt) > new Date()
    ) {
      return NextResponse.json(
        { error: "PENDING_EXISTS", message: "お支払いリンクを発行済みです。少し時間をおいて再度お試しください。" },
        { status: 409 }
      );
    }
    if (eventDate < todayJst()) {
      return NextResponse.json(
        { error: "PAST_EVENT", message: "終了した開催日です。" },
        { status: 400 }
      );
    }
    // GM「ゲーム開始」で受付締切（dartsDayState.entryClosedAt）。以降は支払い不可。
    if (isDartsEntryClosed(await getDartsDayState(season.seasonId, eventDate))) {
      return NextResponse.json(
        { error: "ENTRY_CLOSED", message: "受付は締め切られました。" },
        { status: 409 }
      );
    }

    const completePath = `/info?dartspay=${entryId}`;
    const redirectUrl = isDevLoginEnabled()
      ? `${req.headers.get("origin") || req.nextUrl.origin}${completePath}`
      : liffUrl(completePath);
    let paymentLink: { url: string; orderId: string };
    try {
      paymentLink = await createReservationPaymentLink({
        amount: DARTS_ENTRY_FEE,
        name: "ダーツリーグ参加費",
        redirectUrl,
        purpose: "darts",
      });
    } catch (e) {
      console.error("[darts/entries/pay] payment link failed:", e);
      return NextResponse.json(
        {
          error: "PAYMENT_LINK_FAILED",
          message: isProduction()
            ? "決済リンクの生成に失敗しました。時間をおいてお試しください。"
            : `決済リンク生成に失敗: ${squareErrorDetail(e)}`,
        },
        { status: 502 }
      );
    }

    // リンク生成後、orderId を entry へ保存する時点で締切/中止を **tx 内で再確認** する。
    // すでに締切・中止なら保存せず URL も返さない（Square 側に未使用リンクが残ることは許容）。
    const expiresAt = dayjs().add(PENDING_TTL_MIN, "minute").toISOString();
    const dayRef = db.collection("dartsDayState").doc(`${season.seasonId}_${eventDate}`);
    const cancelRef = db.collection("dartsCancelledDates").doc(eventDate);
    try {
      await db.runTransaction(async (tx) => {
        const daySnap = await tx.get(dayRef);
        const cancelSnap = await tx.get(cancelRef);
        const fresh = await tx.get(entryRef);
        if ((daySnap.data() as { entryClosedAt?: string | null } | undefined)?.entryClosedAt) throw new Error("ENTRY_CLOSED");
        if (cancelSnap.exists) throw new Error("CANCELLED_DATE");
        if (!fresh.exists) throw new Error("NOT_ENTERED");
        const cur = fresh.data() as DartsEntry;
        if (cur.paymentStatus === "paid") throw new Error("ALREADY_PAID");
        if (cur.paymentStatus === "cancelRequested") throw new Error("CANCEL_REQUESTED");
        tx.set(
          entryRef,
          {
            paymentStatus: "pending",
            paymentAmount: DARTS_ENTRY_FEE,
            paymentTransactionId: paymentLink.orderId,
            pendingExpiresAt: expiresAt,
          },
          { merge: true }
        );
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      if (m === "ENTRY_CLOSED") return NextResponse.json({ error: "ENTRY_CLOSED", message: "受付は締め切られました。" }, { status: 409 });
      if (m === "CANCELLED_DATE") return NextResponse.json({ error: "CANCELLED_DATE", message: "この開催日は中止されました。" }, { status: 409 });
      if (m === "ALREADY_PAID") return NextResponse.json({ error: "ALREADY_PAID", message: "すでにお支払い済みです。", alreadyPaid: true }, { status: 409 });
      if (m === "CANCEL_REQUESTED") return NextResponse.json({ error: "CANCEL_REQUESTED", message: "キャンセル依頼中のためお支払いできません。" }, { status: 409 });
      if (m === "NOT_ENTERED") return NextResponse.json({ error: "NOT_ENTERED", message: "先に参加表明が必要です。" }, { status: 400 });
      throw e;
    }

    return NextResponse.json({ entryId, paymentUrl: paymentLink.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[darts/entries/pay] POST error:", message, err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "決済準備中にエラーが発生しました" },
      { status: 500 }
    );
  }
}
