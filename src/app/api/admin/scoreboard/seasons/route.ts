import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import type { ScoreboardGameId } from "@/types";

export const dynamic = "force-dynamic";

/** デフォルトの CS 候補者数 */
const DEFAULT_TOP_N = 3;

/** 全4種目 */
const GAME_IDS: ScoreboardGameId[] = ["mahjong", "poker", "billiards", "darts"];

/**
 * GET /api/admin/scoreboard/seasons
 * シーズン一覧（新しい順）
 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    const snap = await db
      .collection("seasons")
      .orderBy("startDate", "desc")
      .get();

    const seasons = snap.docs.map((doc) => ({
      seasonId: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json({ seasons });
  } catch (error) {
    console.error("[admin/scoreboard/seasons] GET error:", error);
    return NextResponse.json({ error: "シーズン一覧の取得に失敗しました" }, { status: 500 });
  }
}

/**
 * POST /api/admin/scoreboard/seasons
 * シーズン新規作成
 * Body: { name, startDate, endDate, csConfig? }
 */
export async function POST(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { name, startDate, endDate, csConfig } = body;
    const gameCategory: ScoreboardGameId = GAME_IDS.includes(body.gameCategory)
      ? body.gameCategory
      : "mahjong";

    // バリデーション
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "シーズン名は必須です" }, { status: 400 });
    }
    if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      return NextResponse.json({ error: "開始日（YYYY-MM-DD）は必須です" }, { status: 400 });
    }
    if (!endDate || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return NextResponse.json({ error: "終了日（YYYY-MM-DD）は必須です" }, { status: 400 });
    }
    if (startDate >= endDate) {
      return NextResponse.json({ error: "終了日は開始日より後にしてください" }, { status: 400 });
    }

    // CS 設定: デフォルト値をマージ
    const finalCsConfig: Record<string, { topN: number }> = {};
    for (const gid of GAME_IDS) {
      const n = csConfig?.[gid]?.topN;
      finalCsConfig[gid] = { topN: (typeof n === "number" && n >= 1) ? n : DEFAULT_TOP_N };
    }

    const db = getDb();
    const now = new Date().toISOString();

    const data = {
      name: name.trim(),
      gameCategory,
      startDate,
      endDate,
      active: true,
      csConfig: finalCsConfig,
      // 麻雀の順位方式（アベレージ / 合計点。未指定はアベレージ）
      rankingMetric: body.rankingMetric === "total" ? "total" : "average",
      createdAt: now,
      updatedAt: now,
    };

    const docRef = await db.collection("seasons").add(data);

    return NextResponse.json({
      success: true,
      season: { seasonId: docRef.id, ...data },
    });
  } catch (error) {
    console.error("[admin/scoreboard/seasons] POST error:", error);
    return NextResponse.json({ error: "シーズンの作成に失敗しました" }, { status: 500 });
  }
}
