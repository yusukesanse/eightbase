import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/adminAuth";
import { isProduction } from "@/lib/env";
import { seedSaunaDemo, clearSaunaDemo, SAUNA_DEMO_ACCOUNT_NOTES } from "@/dev-only/saunaDemoSeed";

export const dynamic = "force-dynamic";

/**
 * DEV-ONLY（develop 専用 / main へ入れない）
 * サウナ予約（同伴者必須）の検証データの投入/削除（管理・非本番専用）。
 *  GET                     … 投入されるアカウントの一覧（画面の説明用）
 *  POST   { calendarId? }  … 施設・同伴者候補アカウント・「自分が同伴者」の予約を投入
 *  DELETE                  … 上記を削除（サウナ施設の実予約・GCalイベントも消す）
 *
 * ガード: 本番では常に 404（機能自体を隠す）。加えて管理者認証必須。
 */

function guardProd(): NextResponse | null {
  if (isProduction()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const blocked = guardProd();
  if (blocked) return blocked;
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    { accounts: SAUNA_DEMO_ACCOUNT_NOTES },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: NextRequest) {
  const blocked = guardProd();
  if (blocked) return blocked;
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { calendarId } = (await req.json().catch(() => ({}))) as { calendarId?: string };
    const summary = await seedSaunaDemo({ calendarId });
    return NextResponse.json({ success: true, summary });
  } catch (error) {
    console.error("[admin/reservations/demo-data] POST error:", error);
    return NextResponse.json({ error: "ダミー投入に失敗しました" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const blocked = guardProd();
  if (blocked) return blocked;
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const summary = await clearSaunaDemo();
    return NextResponse.json({ success: true, summary });
  } catch (error) {
    console.error("[admin/reservations/demo-data] DELETE error:", error);
    return NextResponse.json({ error: "ダミー削除に失敗しました" }, { status: 500 });
  }
}
