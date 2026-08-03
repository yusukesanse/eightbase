import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/adminAuth";
import { listUnconfirmedPayments, markGameEntryPaid, isPaymentGame } from "@/lib/gameEntryPayment";

export const dynamic = "force-dynamic";

/**
 * 参加費の「入金確認待ち」= 決済リンクは発行済みなのに未払いのままのエントリーを扱う管理API。
 *
 * 4種目で1本にしている（種目は game パラメータ）。種目別に4本コピーすると、
 * 今回の障害（同じ処理が3箇所に散って噛み合わせを誰も検証できなかった）と同じ轍を踏むため。
 *
 * GET  /api/admin/games/payments?game=darts        → 候補一覧
 * POST /api/admin/games/payments  { game, entryId } → Square照合のうえ支払い済みにする
 */

function parseGame(v: unknown) {
  return isPaymentGame(v) ? v : null;
}

export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const game = parseGame(req.nextUrl.searchParams.get("game"));
  if (!game) return NextResponse.json({ error: "game が不正です" }, { status: 400 });

  try {
    return NextResponse.json({ items: await listUnconfirmedPayments(game) });
  } catch (error) {
    console.error("[admin/games/payments] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const admin = await checkAdminAuth(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const game = parseGame(body.game);
    const entryId = typeof body.entryId === "string" ? body.entryId : "";

    if (!game) return NextResponse.json({ error: "game が不正です" }, { status: 400 });
    if (!/^[A-Za-z0-9_-]+$/.test(entryId)) {
      return NextResponse.json({ error: "entryId が不正です" }, { status: 400 });
    }

    const result = await markGameEntryPaid(game, entryId, admin);
    if (!result.ok) {
      // 入金が確認できない=402、状態や二重対応の問題=409、存在しない=404。
      const status =
        result.code === "NOT_FOUND" ? 404 : result.code === "VERIFY_FAILED" ? 402 : 409;
      return NextResponse.json({ error: result.message, code: result.code }, { status });
    }
    return NextResponse.json({ success: true, alreadyPaid: result.alreadyPaid });
  } catch (error) {
    console.error("[admin/games/payments] POST error:", error);
    return NextResponse.json({ error: "処理に失敗しました" }, { status: 500 });
  }
}
