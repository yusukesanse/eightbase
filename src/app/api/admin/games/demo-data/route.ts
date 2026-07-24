import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/adminAuth";
import { isProduction } from "@/lib/env";
import { getDb } from "@/lib/firebaseAdmin";
import { seedDemoParticipants, clearDemoParticipants } from "@/dev-only/demoSeed";
import { seedDemoDartsParticipants } from "@/dev-only/dartsDemoSeed";
import { seedDemoBilliardsParticipants } from "@/dev-only/billiardsDemoSeed";
import { seedDemoPokerParticipants } from "@/dev-only/pokerDemoSeed";

export const dynamic = "force-dynamic";

/**
 * DEV-ONLY（develop 専用 / main へ入れない）
 * 検証用ダミー参加者データの投入/削除（管理・非本番専用）。
 *  POST   { seasonId }  … 指定シーズンにダミーを投入（支払い済み参加・順位・当日卓・CS）
 *  DELETE               … demoDummy タグのゲームデータを一括削除（シーズン/アカウントは残す）
 *
 * ガード: 本番では常に 404（機能自体を隠す）。加えて管理者認証必須。
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
    const { seasonId } = (await req.json().catch(() => ({}))) as { seasonId?: string };
    if (!seasonId || typeof seasonId !== "string") {
      return NextResponse.json({ error: "seasonId が必要です" }, { status: 400 });
    }
    // シーズンの種目で投入内容を分岐（darts ならダーツ用ダミー）。
    const seasonDoc = await getDb().collection("seasons").doc(seasonId).get();
    const category = seasonDoc.data()?.gameCategory;
    const summary =
      category === "darts"
        ? await seedDemoDartsParticipants(seasonId)
        : category === "billiards"
          ? await seedDemoBilliardsParticipants(seasonId)
          : category === "poker"
            ? await seedDemoPokerParticipants(seasonId)
            : await seedDemoParticipants(seasonId);
    return NextResponse.json({ success: true, category: category ?? "mahjong", summary });
  } catch (error) {
    console.error("[admin/games/demo-data] POST error:", error);
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
    const summary = await clearDemoParticipants();
    return NextResponse.json({ success: true, summary });
  } catch (error) {
    console.error("[admin/games/demo-data] DELETE error:", error);
    return NextResponse.json({ error: "ダミー削除に失敗しました" }, { status: 500 });
  }
}
