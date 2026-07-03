import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { todayJst } from "@/lib/date";
import {
  buildLeagueAssignmentEntries,
  countCompletedTables,
  getActiveSeason,
} from "@/lib/mahjong";
import type { MahjongLeagueAssignment } from "@/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/mahjong/leagues?seasonId=xxx
 * リーグ編成スナップショットの履歴（新しい順）。seasonId 未指定ならアクティブシーズン
 */
export async function GET(req: NextRequest) {
  const admin = await checkAdminAuth(req);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let seasonId = req.nextUrl.searchParams.get("seasonId");
    if (!seasonId) {
      const season = await getActiveSeason();
      if (!season) return NextResponse.json({ assignments: [], seasonId: null });
      seasonId = season.seasonId;
    }

    const snap = await getDb()
      .collection("mahjongLeagueAssignments")
      .where("seasonId", "==", seasonId)
      .get();

    const assignments = snap.docs
      .map((d) => ({ ...(d.data() as MahjongLeagueAssignment), assignmentId: d.id }))
      .sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt));

    return NextResponse.json({ assignments, seasonId });
  } catch (error) {
    console.error("[admin/mahjong/leagues] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

/**
 * POST /api/admin/mahjong/leagues
 * 現時点の通算順位をリーグ編成として確定・スナップショット保存する。
 * body: { eventDate?: string }  ※対象開催日（YYYY-MM-DD）。未指定なら今日（JST）
 */
export async function POST(req: NextRequest) {
  const admin = await checkAdminAuth(req);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const eventDate: string =
      typeof body?.eventDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.eventDate)
        ? body.eventDate
        : todayJst();

    const season = await getActiveSeason();
    if (!season) {
      return NextResponse.json(
        { error: "アクティブなシーズンがありません" },
        { status: 400 }
      );
    }

    const entries = await buildLeagueAssignmentEntries(season.seasonId);
    if (entries.length === 0) {
      return NextResponse.json(
        { error: "集計対象の成績がありません（完了した卓がありません）" },
        { status: 400 }
      );
    }

    const tableCount = await countCompletedTables(season.seasonId);
    const now = new Date().toISOString();

    const assignment: Omit<MahjongLeagueAssignment, "assignmentId"> = {
      seasonId: season.seasonId,
      eventDate,
      confirmedAt: now,
      confirmedBy: admin,
      entries,
      tableCount,
    };

    const ref = await getDb().collection("mahjongLeagueAssignments").add(assignment);

    return NextResponse.json(
      { assignment: { ...assignment, assignmentId: ref.id } },
      { status: 201 }
    );
  } catch (error) {
    console.error("[admin/mahjong/leagues] POST error:", error);
    return NextResponse.json({ error: "確定に失敗しました" }, { status: 500 });
  }
}
