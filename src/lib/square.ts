/**
 * Square 決済ユーティリティ
 *
 * 予約ごとの「動的決済リンク方式」で使用する:
 *   決済する時に `createReservationPaymentLink` で予約専用リンクを生成（redirect_url に `?rid=予約ID`）。
 *   生成した注文ID(orderId)を予約に保存し、決済後リダイレクトでは rid から予約→保存orderId を引き、
 *   注文→決済を取得して完了・金額を照合する（verifySquareOrderPayment）。
 *   ※静的共有リンクは Square がリダイレクトに識別子を付けず注文も使い回すため不採用。
 */

import { SquareClient, SquareEnvironment } from "square";

/**
 * Square 決済の用途。用途ごとに別アカウント/店舗(Location)へ売上を分けられる。
 * - reservation … 施設予約（トレーラー等）。従来の SQUARE_* を使用。
 * - mahjong     … 麻雀リーグ参加費。SQUARE_MAHJONG_* を優先し、未設定時は SQUARE_* にフォールバック。
 */
export type SquarePurpose = "reservation" | "mahjong" | "darts";

// 用途ごとにクライアントをキャッシュ（トークン/環境が異なるため共有しない）。
const _clients: Partial<Record<SquarePurpose, SquareClient>> = {};

/**
 * 用途に応じた Square 資格情報を解決する。
 * - mahjong … SQUARE_MAHJONG_* を優先し、無ければ共通 SQUARE_* にフォールバック。
 * - darts   … SQUARE_DARTS_*   を優先し、無ければ共通 SQUARE_* にフォールバック（別会計にするなら darts を設定）。
 * - reservation … 共通 SQUARE_*。
 */
function resolveSquareEnv(purpose: SquarePurpose): {
  token?: string;
  environment: SquareEnvironment;
  locationId?: string;
} {
  const pick = (
    mahjongVar: string | undefined,
    dartsVar: string | undefined,
    sharedVar: string | undefined
  ) => {
    if (purpose === "mahjong") return mahjongVar ?? sharedVar;
    if (purpose === "darts") return dartsVar ?? sharedVar;
    return sharedVar;
  };

  const token = pick(
    process.env.SQUARE_MAHJONG_ACCESS_TOKEN,
    process.env.SQUARE_DARTS_ACCESS_TOKEN,
    process.env.SQUARE_ACCESS_TOKEN
  );
  const envStr = pick(
    process.env.SQUARE_MAHJONG_ENVIRONMENT,
    process.env.SQUARE_DARTS_ENVIRONMENT,
    process.env.SQUARE_ENVIRONMENT
  );
  const locationId = pick(
    process.env.SQUARE_MAHJONG_LOCATION_ID,
    process.env.SQUARE_DARTS_LOCATION_ID,
    process.env.SQUARE_LOCATION_ID
  );
  const environment =
    envStr === "production" ? SquareEnvironment.Production : SquareEnvironment.Sandbox;
  return { token, environment, locationId };
}

/** 用途別の Square 環境変数名（エラーメッセージ用）。 */
function squareEnvVarName(purpose: SquarePurpose, key: "ACCESS_TOKEN" | "LOCATION_ID"): string {
  if (purpose === "mahjong") return `SQUARE_MAHJONG_${key}（未設定時は SQUARE_${key}）`;
  if (purpose === "darts") return `SQUARE_DARTS_${key}（未設定時は SQUARE_${key}）`;
  return `SQUARE_${key}`;
}

export function getSquareClient(purpose: SquarePurpose = "reservation"): SquareClient {
  const cached = _clients[purpose];
  if (cached) return cached;

  const { token, environment } = resolveSquareEnv(purpose);
  if (!token) {
    throw new Error(`${squareEnvVarName(purpose, "ACCESS_TOKEN")} が設定されていません`);
  }

  const client = new SquareClient({ token, environment });
  _clients[purpose] = client;
  return client;
}

export function getSquareLocationId(purpose: SquarePurpose = "reservation"): string {
  const { locationId } = resolveSquareEnv(purpose);
  if (!locationId) {
    throw new Error(`${squareEnvVarName(purpose, "LOCATION_ID")} が設定されていません`);
  }
  return locationId;
}

/** Square SDK エラーから人間可読な詳細を取り出す（非本番のデバッグ表示用）。 */
export function squareErrorDetail(e: unknown): string {
  if (e && typeof e === "object") {
    const anyE = e as { errors?: unknown; body?: unknown; message?: string };
    if (anyE.errors) return JSON.stringify(anyE.errors);
    if (anyE.body) return typeof anyE.body === "string" ? anyE.body : JSON.stringify(anyE.body);
    if (anyE.message) return anyE.message;
  }
  return String(e);
}

export async function getSquarePayment(
  paymentId: string,
  purpose: SquarePurpose = "reservation"
) {
  const client = getSquareClient(purpose);
  const response = await client.payments.get({ paymentId });
  return response.payment;
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
  purpose = "reservation",
}: {
  orderId: string;
  expectedAmount: number;
  purpose?: SquarePurpose;
}): Promise<{ orderId: string; paymentId: string }> {
  const client = getSquareClient(purpose);
  const orderRes = await client.orders.get({ orderId });
  const order = orderRes.order;
  if (!order) {
    throw new Error("注文が見つかりません");
  }
  const paymentId = order.tenders?.find((t) => t.paymentId)?.paymentId;
  if (!paymentId) {
    throw new Error("注文に決済が紐づいていません");
  }
  const payment = await getSquarePayment(paymentId, purpose);
  assertSquarePaymentValid(payment, expectedAmount);
  return { orderId, paymentId };
}

/**
 * 用途ごとの Square Payment Link（動的リンク）を生成する。
 *
 * 静的リンクと異なり redirect_url に識別子(`?rid=...`/`?mjpay=...`)を埋め込めるため、決済後に
 * どの予約/参加の決済かを確実に特定できる。生成した注文ID(orderId)を保存し、
 * 戻り後に COMPLETED/金額を `verifySquareOrderPayment` で照合する。
 * purpose で用途別アカウント/店舗（reservation / mahjong）を切り替える。
 * @returns { url, orderId }
 * @throws 生成失敗時にエラー
 */
export async function createReservationPaymentLink({
  amount,
  name,
  redirectUrl,
  purpose = "reservation",
}: {
  amount: number;
  name: string;
  redirectUrl: string;
  purpose?: SquarePurpose;
}): Promise<{ url: string; orderId: string }> {
  const client = getSquareClient(purpose);
  const { randomUUID } = await import("crypto");
  const res = await client.checkout.paymentLinks.create({
    idempotencyKey: randomUUID(),
    quickPay: {
      name,
      priceMoney: { amount: BigInt(amount), currency: "JPY" },
      locationId: getSquareLocationId(purpose),
    },
    checkoutOptions: { redirectUrl },
  });
  const link = res.paymentLink;
  if (!link?.url || !link?.orderId) {
    throw new Error("決済リンクの生成に失敗しました");
  }
  return { url: link.url, orderId: link.orderId };
}
