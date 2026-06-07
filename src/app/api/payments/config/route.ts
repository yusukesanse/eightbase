import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/payments/config
 * フロントエンドに必要な Square 設定を返す
 * (Application ID は公開情報、Access Token は返さない)
 */
export async function GET() {
  const applicationId = process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID;
  const locationId = process.env.SQUARE_LOCATION_ID;
  const environment = process.env.SQUARE_ENVIRONMENT === "production"
    ? "production"
    : "sandbox";

  if (!applicationId || !locationId) {
    return NextResponse.json(
      { error: "Square の設定が完了していません" },
      { status: 503 }
    );
  }

  return NextResponse.json({
    applicationId,
    locationId,
    environment,
  });
}
