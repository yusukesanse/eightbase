import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/adminAuth";
import { isProduction } from "@/lib/env";
import { seedDemoApp, clearDemoApp } from "@/dev-only/appSeed";

export const dynamic = "force-dynamic";

/**
 * DEV-ONLY（develop 専用 / main へ入れない）
 * demo 環境を**アプリ全体で**一括に整える / 片付ける。
 *  POST   … 施設・サウナ・ニュース・イベント・掲示板・4種目のシーズンと参加データを投入
 *  DELETE … 上記を削除（標準施設は残す）
 *
 * 種目単位・機能単位に分かれていた投入ツールの**単一の入口**。
 * ガード: 本番では常に 404。加えて管理者認証必須。
 */

function guardProd(): NextResponse | null {
  if (isProduction()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return null;
}

export async function POST(req: NextRequest) {
  const blocked = guardProd();
  if (blocked) return blocked;
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const summary = await seedDemoApp();
    return NextResponse.json({ success: true, summary });
  } catch (error) {
    console.error("[admin/demo-data] POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "投入に失敗しました" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const blocked = guardProd();
  if (blocked) return blocked;
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const summary = await clearDemoApp();
    return NextResponse.json({ success: true, summary });
  } catch (error) {
    console.error("[admin/demo-data] DELETE error:", error);
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }
}
