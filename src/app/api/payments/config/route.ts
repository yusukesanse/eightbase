import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/payments/config — 決済機能は現在無効。
 *
 * Square 設定（applicationId 等）は返さず、常に 501 PAYMENT_DISABLED を返す。
 */
export async function GET() {
  return NextResponse.json(
    { error: "PAYMENT_DISABLED", message: "決済機能は現在無効です。" },
    { status: 501 }
  );
}
