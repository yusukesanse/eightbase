/**
 * Square 決済ユーティリティ
 *
 * トレーラー等の「静的決済リンク方式」で使用する:
 *   決済後リダイレクトの orderId → 注文→決済を取得し、完了・金額を照合（verifySquareOrderPayment）。
 *   共有リンクのため referenceId は使わない（予約との紐付けは pending予約Cookieで行う）。
 * 旧 verifySquarePayment（referenceId=userId 前提の動的決済向け）は後方互換で残置。
 */

import { SquareClient, SquareEnvironment } from "square";
import type { Facility } from "@/types";
let _client: SquareClient | null = null;

export function getSquareClient(): SquareClient {
  if (_client) return _client;

  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) {
    throw new Error("SQUARE_ACCESS_TOKEN が設定されていません");
  }

  const environment = process.env.SQUARE_ENVIRONMENT === "production"
    ? SquareEnvironment.Production
    : SquareEnvironment.Sandbox;

  _client = new SquareClient({
    token,
    environment,
  });

  return _client;
}

export function getSquareLocationId(): string {
  const id = process.env.SQUARE_LOCATION_ID;
  if (!id) throw new Error("SQUARE_LOCATION_ID が設定されていません");
  return id;
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    throw new Error("予約時刻の形式が不正です");
  }
  return hours * 60 + minutes;
}

export function calculateReservationAmount(
  facility: Facility,
  startTime: string,
  endTime: string
): number {
  if (!facility.requirePayment) return 0;
  const hourlyRate = facility.hourlyRate ?? 0;
  if (hourlyRate <= 0) {
    throw new Error("施設の決済設定が不正です");
  }

  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (end <= start) {
    throw new Error("予約終了時刻が開始時刻以前です");
  }

  return Math.round((hourlyRate * (end - start)) / 60);
}

export async function getSquarePayment(paymentId: string) {
  const client = getSquareClient();
  const response = await client.payments.get({ paymentId });
  return response.payment;
}

export async function verifySquarePayment({
  paymentId,
  expectedAmount,
  userId,
}: {
  paymentId: string;
  expectedAmount: number;
  userId: string;
}): Promise<void> {
  const payment = await getSquarePayment(paymentId);
  if (!payment) {
    throw new Error("決済情報が見つかりません");
  }
  if (payment.status !== "COMPLETED") {
    throw new Error("決済が完了していません");
  }

  const amount = payment.amountMoney?.amount;
  if (amount === undefined || amount === null || BigInt(expectedAmount) !== BigInt(amount)) {
    throw new Error("決済金額が予約金額と一致しません");
  }

  const expectedReferenceId = userId.substring(0, 40);
  if (payment.referenceId !== expectedReferenceId) {
    throw new Error("決済ユーザーが一致しません");
  }
}

/**
 * 取得済みの payment が「完了済み・金額一致・JPY」かを検証する純粋関数（テスト容易化）。
 * @throws 不一致時にエラー
 */
export function assertSquarePaymentValid(
  payment:
    | {
        status?: string | null;
        amountMoney?: { amount?: bigint | number | null; currency?: string | null } | null;
      }
    | null
    | undefined,
  expectedAmount: number
): void {
  if (!payment) {
    throw new Error("決済情報が見つかりません");
  }
  if (payment.status !== "COMPLETED") {
    throw new Error("決済が完了していません");
  }
  const amount = payment.amountMoney?.amount;
  if (amount === undefined || amount === null || BigInt(expectedAmount) !== BigInt(amount)) {
    throw new Error("決済金額が予約金額と一致しません");
  }
  const currency = payment.amountMoney?.currency;
  if (currency && currency !== "JPY") {
    throw new Error("決済通貨が不正です");
  }
}

/**
 * 静的決済リンク方式（トレーラー等）の検証。
 * 決済後リダイレクトの orderId から注文→紐づく payment を取得し、完了・金額を照合する。
 * @returns 予約への保存・再利用防止に使う { orderId, paymentId }
 * @throws 未完了 / 金額不一致 / 取得失敗時にエラー
 */
export async function verifySquareOrderPayment({
  orderId,
  expectedAmount,
}: {
  orderId: string;
  expectedAmount: number;
}): Promise<{ orderId: string; paymentId: string }> {
  const client = getSquareClient();
  const orderRes = await client.orders.get({ orderId });
  const order = orderRes.order;
  if (!order) {
    throw new Error("注文が見つかりません");
  }
  const paymentId = order.tenders?.find((t) => t.paymentId)?.paymentId;
  if (!paymentId) {
    throw new Error("注文に決済が紐づいていません");
  }
  const payment = await getSquarePayment(paymentId);
  assertSquarePaymentValid(payment, expectedAmount);
  return { orderId, paymentId };
}

/**
 * Square 決済の返金を実行
 * @returns 返金ID（成功時）
 * @throws 返金失敗時にエラー
 */
export async function refundSquarePayment(
  paymentId: string,
  amountYen: number
): Promise<string> {
  const client = getSquareClient();
  const crypto = await import("crypto");
  const idempotencyKey = crypto.randomUUID();

  const response = await client.refunds.refundPayment({
    idempotencyKey,
    paymentId,
    amountMoney: {
      amount: BigInt(amountYen),
      currency: "JPY",
    },
    reason: "予約作成失敗のため自動返金",
  });

  const refund = response.refund;
  if (!refund || !refund.id) {
    throw new Error("返金レスポンスが不正です");
  }

  return refund.id;
}
