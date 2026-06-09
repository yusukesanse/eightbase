import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import type { ScoreboardGameId } from "@/types";

export const dynamic = "force-dynamic";

const GAME_IDS: ScoreboardGameId[] = ["mahjong", "poker", "billiards", "darts"];

/**
 * GET /api/admin/scoreboard/seasons/[seasonId]
 * シーズン詳細取得
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ seasonId: string }> }
) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { seasonId } = await params;
    const db = getDb();
    const doc = await db.collection("seasons").doc(seasonId).get();

    if (!doc.exists) {
      return NextResponse.json({ error: "シーズンが見つかりません" }, { status: 404 });
    }

    return NextResponse.json({
      season: { seasonId: doc.id, ...doc.data() },
    });
  } catch (error) {
    console.error("[admin/scoreboard/seasons/[id]] GET error:", error);
    return NextResponse.json({ error: "シーズンの取得に失敗しました" }, { status: 500 });
  }
}

/**
 * PUT /api/admin/scoreboard/seasons/[seasonId]
 * シーズン更新
 * Body: { name?, startDate?, endDate?, active?, csConfig? }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ seasonId: string }> }
) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { seasonId } = await params;
    const body = await req.json();

    const db = getDb();
    const docRef = db.collection("seasons").doc(seasonId);
    const doc = await docRef.get();
    if (!doc.exists) {
      return NextResponse.json({ error: "シーズンが見つかりません" }, { status: 404 });
    }

    const updates: Record<string, unknown> = {};

    // 名前
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || body.name.trim().length === 0) {
        return NextResponse.json({ error: "シーズン名は必須です" }, { status: 400 });
      }
      updates.name = body.name.trim();
    }

    // 日付
    if (body.startDate !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.startDate)) {
        return NextResponse.json({ error: "開始日の形式が不正です" }, { status: 400 });
      }
      updates.startDate = body.startDate;
    }
    if (body.endDate !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.endDate)) {
        return NextResponse.json({ error: "終了日の形式が不正です" }, { status: 400 });
      }
      updates.endDate = body.endDate;
    }

    // 日付の前後チェック
    const existingData = doc.data()!;
    const finalStart = (updates.startDate ?? existingData.startDate) as string;
    const finalEnd = (updates.endDate ?? existingData.endDate) as string;
    if (finalStart >= finalEnd) {
      return NextResponse.json({ error: "終了日は開始日より後にしてください" }, { status: 400 });
    }

    // active
    if (body.active !== undefined) {
      if (typeof body.active !== "boolean") {
        return NextResponse.json({ error: "active は真偽値です" }, { status: 400 });
      }
      updates.active = body.active;
    }

    // csConfig
    if (body.csConfig !== undefined) {
      const merged: Record<string, { topN: number }> = { ...existingData.csConfig };
      for (const gid of GAME_IDS) {
        if (body.csConfig[gid]?.topN !== undefined) {
          const n = Number(body.csConfig[gid].topN);
          if (n >= 1) merged[gid] = { topN: n };
        }
      }
      updates.csConfig = merged;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "更新するフィールドがありません" }, { status: 400 });
    }

    updates.updatedAt = new Date().toISOString();
    await docRef.update(updates);

    const updated = await docRef.get();
    return NextResponse.json({
      success: true,
      season: { seasonId: updated.id, ...updated.data() },
    });
  } catch (error) {
    console.error("[admin/scoreboard/seasons/[id]] PUT error:", error);
    return NextResponse.json({ error: "シーズンの更新に失敗しました" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/scoreboard/seasons/[seasonId]
 * シーズン削除
 * ※ 紐付けスコアがある場合は削除不可
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ seasonId: string }> }
) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { seasonId } = await params;
    const db = getDb();
    const docRef = db.collection("seasons").doc(seasonId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return NextResponse.json({ error: "シーズンが見つかりません" }, { status: 404 });
    }

    // スコアが紐付いている場合は削除不可
    const scoresSnap = await db
      .collection("scores")
      .where("seasonId", "==", seasonId)
      .limit(1)
      .get();

    if (!scoresSnap.empty) {
      return NextResponse.json(
        { error: "このシーズンにはスコアが登録されているため削除できません" },
        { status: 409 }
      );
    }

    await docRef.delete();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/scoreboard/seasons/[id]] DELETE error:", error);
    return NextResponse.json({ error: "シーズンの削除に失敗しました" }, { status: 500 });
  }
}
