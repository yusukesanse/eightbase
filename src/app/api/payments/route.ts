import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/payments — 決済機能は現在無効。
 *
 * Square 決済は現時点では使わない方針のため、常に 501 PAYMENT_DISABLED を返す。
 * 将来決済を再開する場合の実装雛形は src/lib/square.ts を参照（現時点で未使用）。
 */
export async function POST() {
  return NextResponse.json(
    { error: "PAYMENT_DISABLED", message: "決済機能は現在無効です。" },
    { status: 501 }
  );
}
