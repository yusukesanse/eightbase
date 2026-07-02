import { NextResponse } from "next/server";
import { isDevLoginEnabled } from "@/lib/env";
import { seedDemoMahjong } from "@/lib/devSeed";

export const dynamic = "force-dynamic";

/**
 * POST /api/dev/seed  （検証環境専用）
 * 麻雀の検証データ（シーズン/日程/卓/参加/CS）を Firestore に投入する。冪等。
 * `NEXT_PUBLIC_DEV_LOGIN` 有効（非本番）でのみ動作。本番は 404。
 */
export async function POST() {
  if (!isDevLoginEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const summary = await seedDemoMahjong();
    return NextResponse.json({ success: true, summary });
  } catch (error) {
    console.error("[dev/seed] error:", error);
    return NextResponse.json({ error: "検証データの投入に失敗しました" }, { status: 500 });
  }
}
