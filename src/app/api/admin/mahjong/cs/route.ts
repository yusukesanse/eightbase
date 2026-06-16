import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getActiveSeason } from "@/lib/mahjong";
import { MAHJONG_CS_MIN_GAMES } from "@/types";
import type {
  MahjongCsEntrant,
  MahjongCsEvent,
  MahjongLeagueAssignment,
} from "@/types";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** GET /api/admin/mahjong/cs?seasonId= — CSイベント一覧（新しい順） */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    let seasonId = req.nextUrl.searchParams.get("seasonId");
    if (!seasonId) {
      const season = await getActiveSeason();
      if (!season) return NextResponse.json({ events: [], seasonId: null });
      seasonId = season.seasonId;
    }
    const snap = await getDb()
      .collection("mahjongCsEvents")
      .where("seasonId", "==", seasonId)
      .get();
    const events = snap.docs
      .map((d) => ({ ...(d.data() as MahjongCsEvent), csEventId: d.id }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return NextResponse.json({ events, seasonId });
  } catch (error) {
    console.error("[admin/mahjong/cs] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

/**
 * POST /api/admin/mahjong/cs
 * CSイベントを作成。最新の確定リーグ編成から出場資格者（5試合以上）を
 * 参戦者として取り込み（M1=シード）。status=setup
 * body: { name: string, eventDate: string }
 */
export async function POST(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json().catch(() => null);
    const name: unknown = body?.name;
    const eventDate: unknown = body?.eventDate;
    if (typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "name は必須です" }, { status: 400 });
    }
    if (typeof eventDate !== "string" || !DATE_RE.test(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }

    const season = await getActiveSeason();
    if (!season) {
      return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });
    }
    const db = getDb();

    // 最新の確定リーグ編成からシード・参戦候補を作る
    const asgnSnap = await db
      .collection("mahjongLeagueAssignments")
      .where("seasonId", "==", season.seasonId)
      .get();
    const assignments = asgnSnap.docs
      .map((d) => d.data() as MahjongLeagueAssignment)
      .sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt));

    let entrants: MahjongCsEntrant[] = [];
    if (assignments.length > 0) {
      entrants = assignments[0].entries
        .filter((e) => e.gamesPlayed >= MAHJONG_CS_MIN_GAMES)
        .map((e) => ({
          lineUserId: e.lineUserId,
          displayName: e.displayName,
          pictureUrl: e.pictureUrl,
          tier: e.tier,
          rank: e.rank,
          seed: e.tier === "M1",
        }));
    }

    const now = new Date().toISOString();
    const event: Omit<MahjongCsEvent, "csEventId"> = {
      seasonId: season.seasonId,
      name: name.trim(),
      eventDate,
      status: "setup",
      entrants,
      rounds: [],
      createdAt: now,
      updatedAt: now,
    };
    const ref = await db.collection("mahjongCsEvents").add(event);
    return NextResponse.json({ event: { ...event, csEventId: ref.id } }, { status: 201 });
  } catch (error) {
    console.error("[admin/mahjong/cs] POST error:", error);
    return NextResponse.json({ error: "作成に失敗しました" }, { status: 500 });
  }
}
