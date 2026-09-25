import { cancelPaidGameEntryWithRefund } from "@/lib/gameEntryPayment";
import { NextRequest, NextResponse } from "next/server";
import { requireGameUserWithRole } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { MAHJONG_CANCEL_POLICY } from "@/lib/date";
import { isValidPokerDate, buildPokerEntryId } from "@/lib/pokerEntryValidation";

export const dynamic = "force-dynamic";

/**
 * POST /api/poker/entries/cancel-payment  Body: { eventDate }
 * 支払い済み参加費をSquareへ全額自動返金。期限は開催日の前日まで。
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireGameUserWithRole(req);
    if (!auth) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    const userId = auth.lineUserId;

    const body = await req.json().catch(() => null);
    const eventDate: unknown = body?.eventDate;
    if (!isValidPokerDate(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }

    const season = await getActiveSeason("poker");
    if (!season) return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });

    const entryId = buildPokerEntryId(season.seasonId, eventDate, userId);
    const result = await cancelPaidGameEntryWithRefund("poker", entryId, userId);
    switch (result.kind) {
      case "NOT_FOUND":
        return NextResponse.json({ error: "参加表明が見つかりません" }, { status: 404 });
      case "NOT_OWNER":
        return NextResponse.json({ error: "NOT_OWNER", message: "対象の参加表明が見つかりません。" }, { status: 400 });
      case "NOT_PAID":
        return NextResponse.json({ error: "NOT_PAID", message: "お支払い済みの参加費のみキャンセルできます。" }, { status: 400 });
      case "DEADLINE_PASSED":
        return NextResponse.json({ error: "DEADLINE_PASSED", message: MAHJONG_CANCEL_POLICY }, { status: 409 });
      case "INVALID_TRANSITION":
        return NextResponse.json({ error: "INVALID_TRANSITION", message: "現在の状態ではキャンセルできません。" }, { status: 409 });
      case "REFUND_FAILED":
        return NextResponse.json({ error: "REFUND_FAILED", message: result.message }, { status: 502 });
      case "OK":
        return NextResponse.json({ success: true });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[poker/entries/cancel-payment] POST error:", message, err);
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "キャンセル処理中にエラーが発生しました" }, { status: 500 });
  }
}
