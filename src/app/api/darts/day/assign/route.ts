import { NextRequest, NextResponse } from "next/server";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason, isGameMaster } from "@/lib/mahjong";
import { assignCricketTeams } from "@/lib/dartsDay";
import { isValidDartsDate, isValidDocId } from "@/lib/dartsEntryValidation";
import type { DartsTeam } from "@/types/darts";

export const dynamic = "force-dynamic";

/**
 * POST /api/darts/day/assign  Body: { eventDate, teams:[{teamId, memberIds:[lineUserId]}] }
 * GM 専用: クリケットの2人1組を編成 → クリケットを申告受付へ（§2.4）。
 * カウントアップ確定が前提。編成検証（1〜2名・全員被覆）は lib で行う。
 */
export async function POST(req: NextRequest) {
  const userId = await requireGameUser(req);
  if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const season = await getActiveSeason("darts");
  if (!season) return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });
  if (!isGameMaster(season, userId)) {
    return NextResponse.json({ error: "ゲームマスターのみ利用できます" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const eventDate: unknown = body?.eventDate;
  const teamsRaw: unknown = body?.teams;
  if (!isValidDartsDate(eventDate)) {
    return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
  }
  if (!Array.isArray(teamsRaw)) {
    return NextResponse.json({ error: "teams は配列で指定してください" }, { status: 400 });
  }
  // 形状検証（teamId は安全な文字列・memberIds は文字列配列）。
  const teams: DartsTeam[] = [];
  for (const t of teamsRaw) {
    if (!t || !isValidDocId(t.teamId) || !Array.isArray(t.memberIds)) {
      return NextResponse.json({ error: "teams の形式が不正です" }, { status: 400 });
    }
    if (!t.memberIds.every((m: unknown) => typeof m === "string")) {
      return NextResponse.json({ error: "memberIds が不正です" }, { status: 400 });
    }
    teams.push({ teamId: t.teamId, memberIds: t.memberIds });
  }

  try {
    const result = await assignCricketTeams(season.seasonId, eventDate, teams);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[darts/day/assign] POST error:", error);
    return NextResponse.json({ error: "チーム編成に失敗しました" }, { status: 500 });
  }
}
