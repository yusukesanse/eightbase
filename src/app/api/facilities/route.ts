import { NextRequest, NextResponse } from "next/server";
import { getFacilities } from "@/lib/facilities";

export const dynamic = "force-dynamic";

/**
 * GET /api/facilities
 * 公開API: アクティブな施設一覧を返す（認証不要）
 * calendarIdは除外して返す（セキュリティ）
 */
export async function GET(req: NextRequest) {
  try {

    const facilities = await getFacilities();
    // calendarId はクライアントに不要なので除外
    const safe = facilities.map(({ calendarId: _cid, ...rest }) => rest);
    // HTTP層ではキャッシュさせず、鮮度管理はクライアントの軽量キャッシュ側で行う。
    return NextResponse.json(
      { facilities: safe },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[api/facilities] Error:", error);
    return NextResponse.json({ error: "施設情報の取得に失敗しました" }, { status: 500 });
  }
}
