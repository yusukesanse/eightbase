import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { clearActiveSeasonCache } from "@/lib/mahjong";
import { sanitizeGameMasterIds } from "@/lib/scoreboardSeason";
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

    // rankingMetric（麻雀の順位方式）
    if (body.rankingMetric !== undefined) {
      updates.rankingMetric = body.rankingMetric === "total" ? "total" : "average";
    }

    // gameMasterIds（手動卓振り分けの GM）。配列を正規化して保存（空配列=自動進行に戻す）。
    if (body.gameMasterIds !== undefined) {
      updates.gameMasterIds = sanitizeGameMasterIds(body.gameMasterIds);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "更新するフィールドがありません" }, { status: 400 });
    }

    updates.updatedAt = new Date().toISOString();
    await docRef.update(updates);
    clearActiveSeasonCache();

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
 * シーズン削除時に一緒に消す、seasonId で紐づく関連コレクション。
 * （麻雀リーグ/CS/スコアボードの各データ。`games` は季節非依存のため対象外）
 */
const SEASON_LINKED_COLLECTIONS = [
  "scores",
  "cs_events",
  "mahjongEntries",
  "mahjongTables",
  "mahjongSchedule",
  "mahjongLeagueAssignments",
  "mahjongCsEvents",
] as const;

/**
 * 指定コレクションから seasonId に紐づく全ドキュメントを削除する。
 * Firestore の batch write は1回あたり最大500件のため、件数が多くても壊れないよう
 * 500件未満ずつ取得→batch削除を繰り返す。
 * @returns 削除した件数
 */
async function deleteCollectionBySeasonId(
  db: FirebaseFirestore.Firestore,
  collectionName: string,
  seasonId: string
): Promise<number> {
  const PAGE = 450; // 500 の安全マージン
  let total = 0;
  // 取得→削除を繰り返す（削除済みは次クエリに出てこないので進む）
  for (;;) {
    const snap = await db
      .collection(collectionName)
      .where("seasonId", "==", seasonId)
      .limit(PAGE)
      .get();
    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    total += snap.size;

    if (snap.size < PAGE) break;
  }
  return total;
}

/**
 * DELETE /api/admin/scoreboard/seasons/[seasonId]
 * シーズン削除（関連データごと削除）
 * ※ スコア等の関連データがあっても、紐づくドキュメントを全削除してから season を消す。
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

    // 関連データ（scores / 麻雀リーグ・CS 等）を seasonId 単位で全削除してから season 本体を削除。
    for (const collectionName of SEASON_LINKED_COLLECTIONS) {
      await deleteCollectionBySeasonId(db, collectionName, seasonId);
    }
    await docRef.delete();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/scoreboard/seasons/[id]] DELETE error:", error);
    return NextResponse.json({ error: "シーズンの削除に失敗しました" }, { status: 500 });
  }
}
