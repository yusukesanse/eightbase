import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import type { ScoreboardGameId } from "@/types";

export const dynamic = "force-dynamic";

const VALID_GAME_IDS: ScoreboardGameId[] = ["mahjong", "poker", "billiards", "darts"];

/**
 * GET /api/admin/scoreboard/scores?gameId=xxx
 * スコア一覧取得
 * - gameId: 特定ゲームのスコア一覧
 * - seasonId: 特定シーズンのスコア一覧
 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const gameId = req.nextUrl.searchParams.get("gameId");
    const seasonId = req.nextUrl.searchParams.get("seasonId");

    const db = getDb();
    let query = db.collection("scores").orderBy("createdAt", "desc");

    if (gameId) {
      query = db.collection("scores")
        .where("gameId", "==", gameId)
        .orderBy("createdAt", "desc");
    } else if (seasonId) {
      query = db.collection("scores")
        .where("seasonId", "==", seasonId)
        .orderBy("createdAt", "desc");
    }

    const snap = await query.limit(500).get();
    const scores = snap.docs.map((doc) => ({
      scoreId: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json({ scores });
  } catch (error) {
    console.error("[admin/scoreboard/scores] GET error:", error);
    return NextResponse.json({ error: "スコア一覧の取得に失敗しました" }, { status: 500 });
  }
}

/**
 * POST /api/admin/scoreboard/scores
 * スコア新規登録
 * Body: { gameId, gameCategory, lineUserId, seasonId, totalScore, details, playedAt }
 */
export async function POST(req: NextRequest) {
  const adminEmail = await checkAdminAuth(req);
  if (!adminEmail) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { gameId, gameCategory, lineUserId, seasonId, totalScore, details, playedAt } = body;

    // バリデーション
    if (!gameId || typeof gameId !== "string") {
      return NextResponse.json({ error: "gameId は必須です" }, { status: 400 });
    }
    if (!gameCategory || !VALID_GAME_IDS.includes(gameCategory)) {
      return NextResponse.json({ error: "有効な gameCategory を指定してください" }, { status: 400 });
    }
    if (!lineUserId || typeof lineUserId !== "string") {
      return NextResponse.json({ error: "lineUserId は必須です" }, { status: 400 });
    }
    if (!seasonId || typeof seasonId !== "string") {
      return NextResponse.json({ error: "seasonId は必須です" }, { status: 400 });
    }
    if (totalScore === undefined || typeof totalScore !== "number") {
      return NextResponse.json({ error: "totalScore（数値）は必須です" }, { status: 400 });
    }
    if (!details || typeof details !== "object") {
      return NextResponse.json({ error: "details は必須です" }, { status: 400 });
    }

    // 種目別バリデーション
    const detailError = validateDetails(gameCategory, details);
    if (detailError) {
      return NextResponse.json({ error: detailError }, { status: 400 });
    }

    // シーズン存在確認
    const db = getDb();
    const seasonDoc = await db.collection("seasons").doc(seasonId).get();
    if (!seasonDoc.exists) {
      return NextResponse.json({ error: "指定されたシーズンが見つかりません" }, { status: 404 });
    }

    // ゲーム存在確認
    const gameDoc = await db.collection("games").doc(gameId).get();
    if (!gameDoc.exists) {
      return NextResponse.json({ error: "指定されたゲームが見つかりません" }, { status: 404 });
    }

    // 重複チェック（同一ゲーム×同一ユーザー）
    const existingSnap = await db.collection("scores")
      .where("gameId", "==", gameId)
      .where("lineUserId", "==", lineUserId)
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      return NextResponse.json(
        { error: "このユーザーのスコアは既に登録されています。編集から更新してください。" },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    const finalPlayedAt = playedAt || gameDoc.data()?.startAt || now;

    // yearMonth を playedAt から算出
    const yearMonth = finalPlayedAt.slice(0, 7); // YYYY-MM

    const data = {
      gameId,
      gameCategory,
      lineUserId,
      seasonId,
      yearMonth,
      totalScore,
      details,
      playedAt: finalPlayedAt,
      recordedBy: adminEmail,
      createdAt: now,
    };

    const docRef = await db.collection("scores").add(data);

    // ゲームに scoreRegistered フラグを立てる
    await db.collection("games").doc(gameId).update({
      scoreRegistered: true,
      updatedAt: now,
    });

    return NextResponse.json({
      success: true,
      score: { scoreId: docRef.id, ...data },
    });
  } catch (error) {
    console.error("[admin/scoreboard/scores] POST error:", error);
    return NextResponse.json({ error: "スコアの登録に失敗しました" }, { status: 500 });
  }
}

/* ───────── 種目別バリデーション ───────── */

function validateDetails(gameCategory: ScoreboardGameId, details: Record<string, unknown>): string | null {
  switch (gameCategory) {
    case "mahjong": {
      if (!Array.isArray(details.rounds)) return "麻雀: rounds（配列）は必須です";
      for (const r of details.rounds) {
        if (typeof r.rank !== "number" || typeof r.score !== "number") {
          return "麻雀: 各ラウンドに rank と score（数値）が必要です";
        }
      }
      return null;
    }
    case "poker": {
      if (typeof details.tournamentRank !== "number") return "ポーカー: tournamentRank（数値）は必須です";
      if (typeof details.chipCount !== "number") return "ポーカー: chipCount（数値）は必須です";
      return null;
    }
    case "billiards": {
      if (!Array.isArray(details.matches)) return "ビリヤード: matches（配列）は必須です";
      for (const m of details.matches) {
        if (!["win", "lose", "draw"].includes(m.result)) {
          return "ビリヤード: 各マッチの result は win/lose/draw のいずれかです";
        }
        if (typeof m.points !== "number") {
          return "ビリヤード: 各マッチに points（数値）が必要です";
        }
      }
      return null;
    }
    case "darts": {
      if (typeof details.rank !== "number") return "ダーツ: rank（数値）は必須です";
      if (typeof details.points !== "number") return "ダーツ: points（数値）は必須です";
      return null;
    }
    default:
      return "不明な種目です";
  }
}
