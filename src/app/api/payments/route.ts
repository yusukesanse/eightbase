import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { getFacilityById } from "@/lib/facilities";
import { calculateReservationAmount, getSquareClient, getSquareLocationId } from "@/lib/square";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/**
 * POST /api/payments
 * Square 決済を実行する
 *
 * Body: {
 *   sourceId: string,      // Square Web Payments SDK が生成したトークン
 *   facilityId: string,     // 施設ID
 *   date: string,           // 予約日
 *   startTime: string,      // 開始時刻
 *   endTime: string,        // 終了時刻
 * }
 *
 * Returns: { paymentId: string } on success
 */
export async function POST(req: NextRequest) {
  try {
    // 認証チェック
    const userId = await getSessionUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const body = await req.json();
    const { sourceId, amount, facilityId, date, startTime, endTime } = body;

    // バリデーション
    if (!sourceId || typeof sourceId !== "string") {
      return NextResponse.json(
        { error: "決済トークンが不正です" },
        { status: 400 }
      );
    }
    if (!facilityId || typeof facilityId !== "string") {
      return NextResponse.json(
        { error: "施設情報が不正です" },
        { status: 400 }
      );
    }
    if (
      typeof date !== "string" ||
      typeof startTime !== "string" ||
      typeof endTime !== "string" ||
      !date ||
      !startTime ||
      !endTime
    ) {
      return NextResponse.json(
        { error: "予約日時が不正です" },
        { status: 400 }
      );
    }

    const facility = await getFacilityById(facilityId);
    if (!facility) {
      return NextResponse.json({ error: "施設が見つかりません" }, { status: 404 });
    }
    if (!facility.requirePayment) {
      return NextResponse.json(
        { error: "この施設は決済が不要です" },
        { status: 400 }
      );
    }

    const expectedAmount = calculateReservationAmount(facility, startTime, endTime);
    if (typeof amount === "number" && amount !== expectedAmount) {
      return NextResponse.json(
        { error: "決済金額が予約内容と一致しません" },
        { status: 400 }
      );
    }
    if (expectedAmount <= 0 || expectedAmount > 1000000) {
      return NextResponse.json(
        { error: "決済金額が上限を超えています" },
        { status: 400 }
      );
    }

    const client = getSquareClient();
    const locationId = getSquareLocationId();

    // 冪等キー（同じリクエストの二重課金を防止）
    const idempotencyKey = crypto
      .createHash("sha256")
      .update(`${userId}:${facilityId}:${date}:${startTime}:${endTime}:${sourceId}`)
      .digest("hex");

    // Square Payments API で決済実行
    const response = await client.payments.create({
      sourceId,
      idempotencyKey,
      amountMoney: {
        amount: BigInt(expectedAmount),  // 円単位（日本円は小数なし）
        currency: "JPY",
      },
      locationId,
      note: `${facility.name} ${date} ${startTime}〜${endTime}`,
      referenceId: userId.substring(0, 40),  // Square の referenceId は 40 文字制限
    });

    const payment = response.payment;

    if (!payment || payment.status !== "COMPLETED") {
      console.error("[payments] Payment not completed:", payment?.status);
      return NextResponse.json(
        {
          error: "決済が完了しませんでした。カード情報をご確認ください。",
          details: payment?.status,
        },
        { status: 402 }
      );
    }

    console.log(
      `[payments] Success: paymentId=${payment.id}, amount=${expectedAmount}JPY, user=${userId}`
    );

    return NextResponse.json({
      paymentId: payment.id,
      amount: expectedAmount,
      status: payment.status,
    });
  } catch (error: unknown) {
    console.error("[payments] Error:", error);

    // Square API エラーの詳細を取得
    if (error && typeof error === "object" && "errors" in error) {
      const squareErrors = (error as { errors: { code: string; detail: string }[] }).errors;
      const firstError = squareErrors?.[0];

      // カード関連のエラーはユーザーに詳細を返す
      const cardErrorCodes = [
        "CARD_DECLINED",
        "CVV_FAILURE",
        "ADDRESS_VERIFICATION_FAILURE",
        "INVALID_EXPIRATION",
        "CARD_EXPIRED",
        "INSUFFICIENT_FUNDS",
      ];

      if (firstError && cardErrorCodes.includes(firstError.code)) {
        const messages: Record<string, string> = {
          CARD_DECLINED: "カードが拒否されました。別のカードをお試しください。",
          CVV_FAILURE: "セキュリティコードが正しくありません。",
          INVALID_EXPIRATION: "有効期限が正しくありません。",
          CARD_EXPIRED: "カードの有効期限が切れています。",
          INSUFFICIENT_FUNDS: "残高不足です。別のカードをお試しください。",
        };
        return NextResponse.json(
          { error: messages[firstError.code] ?? "カード決済に失敗しました。" },
          { status: 402 }
        );
      }
    }

    return NextResponse.json(
      { error: "決済処理中にエラーが発生しました。しばらくしてからお試しください。" },
      { status: 500 }
    );
  }
}
