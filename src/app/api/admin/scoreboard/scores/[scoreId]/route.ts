import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import type { ScoreboardGameId } from "@/types";

export const dynamic = "force-dynamic";

const VALID_GAME_IDS: ScoreboardGameId[] = ["mahjong", "poker", "billiards", "darts"];

/**
 * GET /api/admin/scoreboard/scores/[scoreId]
 * スコア詳細取得
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ scoreId: string }> }
) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { scoreId } = await params;
    const db = getDb();
    const doc = await db.collection("scores").doc(scoreId).get();

    if (!doc.exists) {
      return NextResponse.json({ error: "スコアが見つかりません" }, { status: 404 });
    }

    return NextResponse.json({
      score: { scoreId: doc.id, ...doc.data() },
    });
  } catch (error) {
    console.error("[admin/scoreboard/scores/[id]] GET error:", error);
    return NextResponse.json({ error: "スコアの取得に失敗しました" }, { status: 500 });
  }
}

/**
 * PUT /api/admin/scoreboard/scores/[scoreId]
 * スコア更新
 * Body: { totalScore?, details? }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ scoreId: string }> }
) {
  const adminEmail = await checkAdminAuth(req);
  if (!adminEmail) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { scoreId } = await params;
    const body = await req.json();

    const db = getDb();
    const docRef = db.collection("scores").doc(scoreId);
    const doc = await docRef.get();
    if (!doc.exists) {
      return NextResponse.json({ error: "スコアが見つかりません" }, { status: 404 });
    }

    const existing = doc.data()!;
    const updates: Record<string, unknown> = {};

    if (body.totalScore !== undefined) {
      if (typeof body.totalScore !== "number") {
        return NextResponse.json({ error: "totalScore は数値です" }, { status: 400 });
      }
      updates.totalScore = body.totalScore;
    }

    if (body.details !== undefined) {
      if (typeof body.details !== "object") {
        return NextResponse.json({ error: "details はオブジェクトです" }, { status: 400 });
      }
      const detailError = validateDetails(existing.gameCategory as ScoreboardGameId, body.details);
      if (detailError) {
        return NextResponse.json({ error: detailError }, { status: 400 });
      }
      updates.details = body.details;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "更新するフィールドがありません" }, { status: 400 });
    }

    updates.recordedBy = adminEmail;
    updates.updatedAt = new Date().toISOString();

    await docRef.update(updates);

    const updated = await docRef.get();
    return NextResponse.json({
      success: true,
      score: { scoreId: updated.id, ...updated.data() },
    });
  } catch (error) {
    console.error("[admin/scoreboard/scores/[id]] PUT error:", error);
    return NextResponse.json({ error: "スコアの更新に失敗しました" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/scoreboard/scores/[scoreId]
 * スコア削除
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ scoreId: string }> }
) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { scoreId } = await params;
    const db = getDb();
    const docRef = db.collection("scores").doc(scoreId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return NextResponse.json({ error: "スコアが見つかりません" }, { status: 404 });
    }

    await docRef.delete();

    // ゲームの scoreRegistered フラグを確認・更新
    const gameId = doc.data()!.gameId as string;
    const remainingSnap = await db.collection("scores")
      .where("gameId", "==", gameId)
      .limit(1)
      .get();

    if (remainingSnap.empty) {
      await db.collection("games").doc(gameId).update({
        scoreRegistered: false,
        updatedAt: new Date().toISOString(),
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/scoreboard/scores/[id]] DELETE error:", error);
    return NextResponse.json({ error: "スコアの削除に失敗しました" }, { status: 500 });
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
      if (typeof details.tournamentRank !== "number") return "ポーカー: tournamentRank は必須です";
      if (typeof details.chipCount !== "number") return "ポーカー: chipCount は必須です";
      return null;
    }
    case "billiards": {
      if (!Array.isArray(details.matches)) return "ビリヤード: matches（配列）は必須です";
      for (const m of details.matches) {
        if (!["win", "lose", "draw"].includes(m.result)) return "ビリヤード: result は win/lose/draw";
        if (typeof m.points !== "number") return "ビリヤード: points（数値）が必要です";
      }
      return null;
    }
    case "darts": {
      if (typeof details.rank !== "number") return "ダーツ: rank は必須です";
      if (typeof details.points !== "number") return "ダーツ: points は必須です";
      return null;
    }
    default:
      return "不明な種目です";
  }
}
