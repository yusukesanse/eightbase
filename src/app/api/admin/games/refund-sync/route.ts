import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/adminAuth";
import { isPaymentGame, listFailedAutoRefunds, syncGameEntryRefund } from "@/lib/gameEntryPayment";

export const dynamic = "force-dynamic";

/** 自動返金失敗候補の一覧。Squareで全額返金済みかを照合して記録する管理API。 */
export async function GET(req: NextRequest) {
  const admin = await checkAdminAuth(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const game = req.nextUrl.searchParams.get("game");
  if (!isPaymentGame(game)) return NextResponse.json({ error: "game が不正です" }, { status: 400 });
  try {
    return NextResponse.json({ items: await listFailedAutoRefunds(game) });
  } catch (error) {
    console.error("[admin/games/refund-sync] GET error:", error);
    return NextResponse.json({ error: "処理に失敗しました" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const admin = await checkAdminAuth(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json().catch(() => null);
    const game = body?.game;
    const entryId = typeof body?.entryId === "string" ? body.entryId : "";
    if (!isPaymentGame(game)) return NextResponse.json({ error: "game が不正です" }, { status: 400 });
    if (!/^[A-Za-z0-9_-]+$/.test(entryId)) {
      return NextResponse.json({ error: "entryId が不正です" }, { status: 400 });
    }
    const result = await syncGameEntryRefund(game, entryId, admin);
    switch (result.kind) {
      case "NOT_FOUND": return NextResponse.json({ error: "参加表明が見つかりません" }, { status: 404 });
      case "NOT_ELIGIBLE": return NextResponse.json({ error: result.kind, message: result.message }, { status: 409 });
      case "REFUND_NOT_FOUND": return NextResponse.json({ error: result.kind, message: "Squareで全額返金が確認できません" }, { status: 409 });
      case "VERIFY_FAILED":
      case "PERSIST_FAILED": return NextResponse.json({ error: result.kind, message: result.message }, { status: 502 });
      case "OK": return NextResponse.json({ success: true, already: result.already });
    }
  } catch (error) {
    console.error("[admin/games/refund-sync] POST error:", error);
    return NextResponse.json({ error: "処理に失敗しました" }, { status: 500 });
  }
}
