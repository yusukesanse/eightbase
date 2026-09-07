/**
 * 麻雀の参加費（3,000円）Square 決済リンクの発行。
 *
 * ■ なぜ切り出したか（WP2: 参加＝支払い）
 *   「参加する」＝ そのまま Square のお支払いへ進む に変えたため、リンク発行が
 *   `POST /api/mahjong/entries`（参加表明）と `POST /api/mahjong/entries/pay`（再発行）の
 *   2 箇所から必要になった。同じ処理を 2 本コピーすると、戻り先 URL・TTL・保存フィールドが
 *   片方だけズレて「支払ったのに未払い」が起きる（2026-08-03 の本番障害と同じ構図）ので、
 *   **リンク発行と pending 化はこのファイルにだけ書く。**
 *
 * 戻り先は必ず `gamePaymentReturnPath("mahjong", entryId)`（= `/games?mjpay=...`）。
 * 会員専用ルートにしないこと（ゲストが AuthGuard に弾かれてクエリごと消える）。
 */

import { NextResponse } from "next/server";
import dayjs from "dayjs";
import { createReservationPaymentLink, squareErrorDetail } from "@/lib/square";
import { liffUrl } from "@/lib/liffUrl";
import { gamePaymentReturnPath } from "@/lib/gamePaymentReturn";
import { isDevLoginEnabled, isProduction } from "@/lib/env";
import { PENDING_TTL_MIN } from "@/lib/trailerPending";
import { MAHJONG_ENTRY_FEE } from "@/types";

/** 仮押さえ（pending）としてエントリーに書き込むフィールド一式。 */
export interface MahjongEntryPaymentFields {
  paymentStatus: "pending";
  paymentAmount: number;
  /** 決済後の照合に使う Square の注文ID。 */
  paymentTransactionId: string;
  /** 仮押さえの失効時刻（ISO8601）。これを過ぎた pending は席を持たない。 */
  pendingExpiresAt: string;
  /** 発行済みの Square 決済URL。戻りが届かなかった利用者を同じリンクへ戻すために保存する。 */
  paymentUrl: string;
}

/** 決済リンク生成に失敗したことを表す。呼び出し側は 502 を返す（entry は作らない）。 */
export class MahjongPaymentLinkError extends Error {
  /** 利用者へそのまま出してよい文言。 */
  readonly userMessage: string;

  constructor(userMessage: string, options?: { cause?: unknown }) {
    super(userMessage, options);
    this.name = "MahjongPaymentLinkError";
    this.userMessage = userMessage;
  }
}

/**
 * {@link MahjongPaymentLinkError} を API レスポンス（502）へ変換する。
 * ⚠️ 想定外の例外（設定漏れ等）も 502 に丸めるが、**必ずログに残す**。
 *   黙って 502 を返すと「Square が落ちている」と誤診して原因に辿り着けない。
 */
export function paymentLinkFailedResponse(e: unknown): NextResponse {
  if (!(e instanceof MahjongPaymentLinkError)) {
    console.error("[mahjongEntryPayment] unexpected error while issuing payment link:", e);
  }
  const message =
    e instanceof MahjongPaymentLinkError
      ? e.userMessage
      : "決済リンクの生成に失敗しました。時間をおいてお試しください。";
  return NextResponse.json({ error: "PAYMENT_LINK_FAILED", message }, { status: 502 });
}

export interface IssueMahjongEntryPaymentLinkArgs {
  /** 戻り先 origin の解決に使う（Dev ログイン時のみ）。 */
  req: { headers: Headers; nextUrl: { origin: string } };
  /** 対象エントリーの docRef（決定的ID なので参加表明の前でも作れる）。 */
  entryRef: FirebaseFirestore.DocumentReference;
  entryId: string;
  /**
   * 発行したフィールドを entryRef へ merge 保存するか。
   * - pay ルート（既存エントリーの再発行）は true（既定）
   * - 参加表明 POST は false ＝ 参加表明トランザクションの中で一緒に書く
   *   （リンクだけ保存されて entry が作られない中途半端な状態を作らないため）
   */
  persist?: boolean;
}

/**
 * 参加費の Square 決済リンクを発行する。
 * 失敗時は {@link MahjongPaymentLinkError} を投げる（pending 化はしない）。
 */
export async function issueMahjongEntryPaymentLink({
  req,
  entryRef,
  entryId,
  persist = true,
}: IssueMahjongEntryPaymentLinkArgs): Promise<{
  paymentUrl: string;
  fields: MahjongEntryPaymentFields;
}> {
  // 戻り先は LINEミニアプリ(LIFF)。demo のブラウザ検証（Dev ログイン時）は Web URL。
  const completePath = gamePaymentReturnPath("mahjong", entryId);
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
    console.error("[mahjongEntryPayment] payment link failed:", e);
    throw new MahjongPaymentLinkError(
      isProduction()
        ? "決済リンクの生成に失敗しました。時間をおいてお試しください。"
        : `決済リンク生成に失敗: ${squareErrorDetail(e)}`,
      { cause: e }
    );
  }

  const fields: MahjongEntryPaymentFields = {
    paymentStatus: "pending",
    paymentAmount: MAHJONG_ENTRY_FEE,
    paymentTransactionId: paymentLink.orderId,
    pendingExpiresAt: dayjs().add(PENDING_TTL_MIN, "minute").toISOString(),
    paymentUrl: paymentLink.url,
  };

  if (persist) await entryRef.set(fields, { merge: true });

  return { paymentUrl: paymentLink.url, fields };
}
