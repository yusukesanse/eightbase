import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUserWithRole } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { mahjongPaymentRequired } from "@/lib/roles";
import {
  issueMahjongEntryPaymentLink,
  paymentLinkFailedResponse,
} from "@/lib/mahjongEntryPayment";
import { todayJst } from "@/lib/date";
import { getDayState, isEntryClosed } from "@/lib/mahjongDay";
import {
  buildMahjongEntryId,
  isValidMahjongDate,
} from "@/lib/mahjongEntryValidation";
import { type MahjongEntry } from "@/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/mahjong/entries/pay  Body: { eventDate }
 * 参加費（3,000円）の「決済前 仮押さえ」。トレーラー予約と同型の Square 動的リンク方式。
 *  1. role が支払い対象（member/guest）か・参加表明済みか・**開催当日かつ開始時刻前**かを検証
 *  2. 参加費専用の Square 決済リンクを生成（戻り先 /games?mjpay=エントリーID＝麻雀ハブ）
 *  3. エントリーを pending 化し注文ID(orderId)を保存 → 決済URLを返す
 *  戻りは /games?mjpay=... 経由で /api/mahjong/entries/complete が確定する。
 *
 *  ※ WP2 以降、通常の導線は `POST /api/mahjong/entries`（参加する＝支払いへ進む）が
 *    リンクを発行する。このルートの役割は「お支払い画面に戻る」「期限切れ後にやり直す」＝**再発行**。
 *    期限内の仮押さえがあるときは新しい注文を切らず、保存済みの決済URLをそのまま返す。
 */
export async function POST(req: NextRequest) {
  try {
    // 認証・アクティブシーズン取得・body 解析は独立＝並列化。
    const [auth, season, body] = await Promise.all([
      requireGameUserWithRole(req),
      getActiveSeason(),
      req.json().catch(() => null),
    ]);
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

    const eventDate: unknown = body?.eventDate;
    if (!isValidMahjongDate(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }

    if (!season) {
      return NextResponse.json(
        { error: "アクティブなシーズンがありません" },
        { status: 400 }
      );
    }

    const db = getDb();
    const entryId = buildMahjongEntryId(season.seasonId, eventDate, userId);
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
    // キャンセル依頼中は支払い不可（返金錯綜・二重order防止）。
    if (entry.paymentStatus === "cancelRequested") {
      return NextResponse.json(
        { error: "CANCEL_REQUESTED", message: "キャンセル依頼中のためお支払いできません。" },
        { status: 409 }
      );
    }
    // 参加後に休催化された場合は支払い不可。
    const closed = await db.collection("mahjongClosedDates").doc(eventDate).get();
    if (closed.exists) {
      return NextResponse.json(
        { error: "CLOSED_DATE", message: "この開催日は休催になりました。" },
        { status: 409 }
      );
    }
    // 二重リンク発行防止: 未失効の pending があれば **保存済みの決済URLをそのまま返す**。
    // ⚠️ 以前はここで 409 PENDING_EXISTS を返していた。WP2 では参加した瞬間に pending になるため、
    //    そのままだと「お支払い画面に戻る」が常に 409 になり支払いを再開できない。
    //    新しい注文を切らないこと（同じ参加費で注文が二重に立つ）。
    //    paymentUrl を保存していない旧データのときだけ、下で発行し直す。
    if (
      entry.paymentStatus === "pending" &&
      entry.pendingExpiresAt &&
      new Date(entry.pendingExpiresAt) > new Date() &&
      entry.paymentUrl
    ) {
      return NextResponse.json({ entryId, paymentUrl: entry.paymentUrl });
    }

    // 参加確定後はいつでも支払い可。締切は **GM が「ゲーム開始」を押した瞬間**。
    // - 過去日: 不可（PAST_EVENT）
    // - GM が開始済み: 締切（CLOSED）
    // - それ以外: 可
    const today = todayJst();
    if (eventDate < today) {
      return NextResponse.json(
        { error: "PAST_EVENT", message: "終了した開催日です。" },
        { status: 400 }
      );
    }
    if (isEntryClosed(await getDayState(season.seasonId, eventDate))) {
      return NextResponse.json(
        { error: "CLOSED", message: "受付を終了しました（ゲームが開始されています）。" },
        { status: 400 }
      );
    }

    // 参加費専用の Square 決済リンクを生成し、エントリーを pending 化する。
    // 発行・保存の実体は src/lib/mahjongEntryPayment.ts（参加表明 POST と共通・種目内でコピーしない）。
    // 失敗時は pending 化する前に中断する（不要な pending を残さない）。
    let paymentUrl: string;
    try {
      ({ paymentUrl } = await issueMahjongEntryPaymentLink({ req, entryRef, entryId }));
    } catch (e) {
      return paymentLinkFailedResponse(e);
    }

    return NextResponse.json({ entryId, paymentUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mahjong/entries/pay] POST error:", message, err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "決済準備中にエラーが発生しました" },
      { status: 500 }
    );
  }
}
