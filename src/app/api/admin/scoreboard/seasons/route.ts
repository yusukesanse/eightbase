import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { clearActiveSeasonCache } from "@/lib/mahjong";
import { sanitizeGameMasterIds, sanitizeSeasonMarkdown, SEASON_MARKDOWN_MAX } from "@/lib/scoreboardSeason";
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
    // orderBy("startDate") は startDate を持たないシーズンを結果から除外してしまうため使わない
    // （seed/旧UIで startDate 未設定のシーズンが管理画面から消える不具合を回避）。
    // 全件取得して JS 側で新しい順（startDate 降順・未設定は末尾）に並べる＝利用者側 listSeasons と一致。
    const snap = await db.collection("seasons").get();

    const seasons = snap.docs
      .map((doc) => ({
        seasonId: doc.id,
        ...doc.data(),
      }))
      .sort((a, b) => {
        const sa = (a as { startDate?: string }).startDate || "";
        const sb = (b as { startDate?: string }).startDate || "";
        return sb.localeCompare(sa);
      });

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

    // ルール・約款（Markdown）
    const rules = sanitizeSeasonMarkdown(body.rulesMarkdown);
    const terms = sanitizeSeasonMarkdown(body.termsMarkdown);
    if (rules === null || terms === null) {
      return NextResponse.json(
        { error: `ルール・約款は${SEASON_MARKDOWN_MAX}文字以内のテキストで入力してください` },
        { status: 400 }
      );
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
      // ゲームマスター（手動卓振り分け）。空=自動進行シーズン。
      gameMasterIds: sanitizeGameMasterIds(body.gameMasterIds),
      // ルール・約款（Markdown）。未指定は空。
      rulesMarkdown: rules,
      termsMarkdown: terms,
      createdAt: now,
      updatedAt: now,
    };

    const docRef = await db.collection("seasons").add(data);
    clearActiveSeasonCache();

    return NextResponse.json({
      success: true,
      season: { seasonId: docRef.id, ...data },
    });
  } catch (error) {
    console.error("[admin/scoreboard/seasons] POST error:", error);
    return NextResponse.json({ error: "シーズンの作成に失敗しました" }, { status: 500 });
  }
}
