import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUserWithRole } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { mahjongPaymentRequired } from "@/lib/roles";
import { createReservationPaymentLink } from "@/lib/square";
import { liffUrl } from "@/lib/liffUrl";
import { isDevLoginEnabled } from "@/lib/env";
import { todayJst } from "@/lib/date";
import { PENDING_TTL_MIN } from "@/lib/trailerPending";
import { MAHJONG_ENTRY_FEE, type MahjongEntry, type MahjongScheduleEntry } from "@/types";
import dayjs from "dayjs";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /api/mahjong/entries/pay  Body: { eventDate }
 * 参加費（3,000円）の「決済前 仮押さえ」。トレーラー予約と同型の Square 動的リンク方式。
 *  1. role が支払い対象（member/guest）か・参加表明済みか・**開催当日かつ開始時刻前**かを検証
 *  2. 参加費専用の Square 決済リンクを生成（戻り先 /games/mahjong?mjpay=エントリーID）
 *  3. エントリーを pending 化し注文ID(orderId)を保存 → 決済URLを返す
 *  戻りは /games/mahjong?mjpay=... 経由で /api/mahjong/entries/complete が確定する。
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireGameUserWithRole(req);
    if (!auth) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }
    const { lineUserId: userId, role } = auth;

    // staff（エイト社員）等 支払い免除者は決済導線に入らない
    if (!mahjongPaymentRequired(role)) {
      return NextResponse.json(
        { error: "PAYMENT_NOT_REQUIRED", message: "参加費のお支払いは不要です。" },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => null);
    const eventDate: unknown = body?.eventDate;
    if (typeof eventDate !== "string" || !DATE_RE.test(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }

    const season = await getActiveSeason();
    if (!season) {
      return NextResponse.json(
        { error: "アクティブなシーズンがありません" },
        { status: 400 }
      );
    }

    const db = getDb();
    const entryId = `${season.seasonId}_${eventDate}_${userId}`;
    const entryRef = db.collection("mahjongEntries").doc(entryId);
    const entrySnap = await entryRef.get();
    if (!entrySnap.exists) {
      return NextResponse.json(
        { error: "NOT_ENTERED", message: "先に参加表明が必要です。" },
        { status: 400 }
      );
    }
    const entry = { ...(entrySnap.data() as MahjongEntry), entryId };
    if (entry.paymentStatus === "paid") {
      return NextResponse.json(
        { error: "ALREADY_PAID", message: "すでにお支払い済みです。", alreadyPaid: true },
        { status: 409 }
      );
    }

    // 参加確定後はいつでも支払い可。支払い期限＝開催当日ゲーム開始時刻（Asia/Tokyo 基準）。
    // - 過去日: 不可（PAST_EVENT）
    // - 当日: 開始時刻を過ぎたら締切（CLOSED）
    // - 未来日: 可
    const today = todayJst();
    if (eventDate < today) {
      return NextResponse.json(
        { error: "PAST_EVENT", message: "終了した開催日です。" },
        { status: 400 }
      );
    }
    if (eventDate === today) {
      const schedSnap = await db
        .collection("mahjongSchedule")
        .where("seasonId", "==", season.seasonId)
        .get();
      const sched = schedSnap.docs
        .map((d) => d.data() as MahjongScheduleEntry)
        .find((s) => s.date === eventDate);
      if (sched?.startTime) {
        const deadline = new Date(`${eventDate}T${sched.startTime}:00+09:00`);
        if (new Date() >= deadline) {
          return NextResponse.json(
            { error: "CLOSED", message: "受付を終了しました（開始時刻を過ぎています）。" },
            { status: 400 }
          );
        }
      }
    }

    // 参加費専用の Square 決済リンクを生成（戻り先にエントリーIDを埋め込む）。
    // 失敗時は pending 化する前に中断（不要な pending を残さない）。
    // 戻り先は LINEミニアプリ(LIFF)。demo のブラウザ検証（Dev ログイン時）は Web URL。
    const completePath = `/games/mahjong?mjpay=${entryId}`;
    const redirectUrl = isDevLoginEnabled()
      ? `${req.headers.get("origin") || req.nextUrl.origin}${completePath}`
      : liffUrl(completePath);
    let paymentLink: { url: string; orderId: string };
    try {
      paymentLink = await createReservationPaymentLink({
        amount: MAHJONG_ENTRY_FEE,
        name: "麻雀リーグ参加費",
        redirectUrl,
        purpose: "mahjong",
      });
    } catch (e) {
      console.error("[mahjong/entries/pay] payment link failed:", e);
      return NextResponse.json(
        {
          error: "PAYMENT_LINK_FAILED",
          message: "決済リンクの生成に失敗しました。時間をおいてお試しください。",
        },
        { status: 502 }
      );
    }

    const expiresAt = dayjs().add(PENDING_TTL_MIN, "minute").toISOString();
    await entryRef.set(
      {
        paymentStatus: "pending",
        paymentAmount: MAHJONG_ENTRY_FEE,
        // 決済後の照合に使う注文ID（この参加費専用リンクの注文）
        paymentTransactionId: paymentLink.orderId,
        pendingExpiresAt: expiresAt,
      },
      { merge: true }
    );

    return NextResponse.json({ entryId, paymentUrl: paymentLink.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mahjong/entries/pay] POST error:", message, err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "決済準備中にエラーが発生しました" },
      { status: 500 }
    );
  }
}
