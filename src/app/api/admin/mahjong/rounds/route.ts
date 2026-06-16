import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { computeStandings, getActiveSeason } from "@/lib/mahjong";
import { generateRound, type MatchPlayer } from "@/lib/mahjongMatching";
import type {
  MahjongEntry,
  MahjongLeagueAssignment,
  MahjongTable,
  MahjongTableMember,
} from "@/types";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 指定開催日のラウンド別卓を返す（管理者） */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const eventDate = req.nextUrl.searchParams.get("eventDate");
    if (!eventDate || !DATE_RE.test(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }
    const season = await getActiveSeason();
    if (!season) return NextResponse.json({ tables: [], seasonId: null });

    const snap = await getDb()
      .collection("mahjongTables")
      .where("seasonId", "==", season.seasonId)
      .get();

    const tables = snap.docs
      .map((d) => ({ ...(d.data() as MahjongTable), tableId: d.id }))
      .filter((t) => t.eventDate === eventDate && typeof t.round === "number")
      .sort((a, b) => (a.round! - b.round!) || (a.tableLabel ?? "").localeCompare(b.tableLabel ?? ""));

    return NextResponse.json({ tables, seasonId: season.seasonId });
  } catch (error) {
    console.error("[admin/mahjong/rounds] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

/**
 * POST /api/admin/mahjong/rounds
 * 次ラウンドの卓を生成する。
 * body: { eventDate: string }
 *
 * - 参加表明者を対象に卓組みエンジンで2卓＋見学者を決定
 * - 順位は最新の確定リーグ編成（なければリアルタイム順位）を使用
 * - 直前ラウンドが未完了（未申告/未検証）の場合は生成不可
 */
export async function POST(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json().catch(() => null);
    const eventDate: unknown = body?.eventDate;
    if (typeof eventDate !== "string" || !DATE_RE.test(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }

    const season = await getActiveSeason();
    if (!season) {
      return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });
    }
    const db = getDb();

    // 参加表明者
    const entrySnap = await db
      .collection("mahjongEntries")
      .where("seasonId", "==", season.seasonId)
      .get();
    const entries = entrySnap.docs
      .map((d) => d.data() as MahjongEntry)
      .filter((e) => e.eventDate === eventDate);
    if (entries.length < 4) {
      return NextResponse.json(
        { error: "参加表明が4人未満のため卓を組めません" },
        { status: 400 }
      );
    }

    // 当日の既存ラウンド卓
    const tableSnap = await db
      .collection("mahjongTables")
      .where("seasonId", "==", season.seasonId)
      .get();
    const dayTables = tableSnap.docs
      .map((d) => ({ ...(d.data() as MahjongTable), tableId: d.id }))
      .filter((t) => t.eventDate === eventDate && typeof t.round === "number");

    const maxRound = dayTables.reduce((m, t) => Math.max(m, t.round ?? 0), 0);
    const nextRound = maxRound + 1;

    // 直前ラウンドが未完了なら生成不可
    if (maxRound > 0) {
      const prev = dayTables.filter((t) => t.round === maxRound);
      if (prev.some((t) => t.status !== "completed")) {
        return NextResponse.json(
          { error: `第${maxRound}ラウンドのスコア申告が未完了です。完了後に次ラウンドを生成してください` },
          { status: 400 }
        );
      }
    }

    // 順位マップ（確定リーグ編成 優先、なければリアルタイム順位）
    const rankMap = new Map<string, number>();
    const asgnSnap = await db
      .collection("mahjongLeagueAssignments")
      .where("seasonId", "==", season.seasonId)
      .get();
    const assignments = asgnSnap.docs
      .map((d) => d.data() as MahjongLeagueAssignment)
      .sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt));
    if (assignments.length > 0) {
      assignments[0].entries.forEach((e) => rankMap.set(e.lineUserId, e.rank));
    } else {
      const standings = await computeStandings(season.seasonId);
      standings.forEach((s) => rankMap.set(s.lineUserId, s.rank));
    }

    // 本日の試合数・直前ラウンド最下位
    const gamesToday = new Map<string, number>();
    const lastPlaceSet = new Set<string>();
    for (const t of dayTables) {
      for (const id of t.memberIds) {
        gamesToday.set(id, (gamesToday.get(id) ?? 0) + 1);
      }
    }
    if (maxRound > 0) {
      for (const t of dayTables.filter((t) => t.round === maxRound)) {
        // その卓の最大順位（=最下位）の人を見学候補に
        const ranked = t.members.filter((m) => m.rank !== null);
        if (ranked.length > 0) {
          const worst = Math.max(...ranked.map((m) => m.rank as number));
          ranked
            .filter((m) => m.rank === worst)
            .forEach((m) => lastPlaceSet.add(m.lineUserId));
        }
      }
    }

    // 未登録順位は末尾に（参加表明順で安定させるため大きな値）
    let fallback = 1000;
    const players: MatchPlayer[] = entries.map((e) => ({
      lineUserId: e.lineUserId,
      displayName: e.displayName,
      pictureUrl: e.pictureUrl,
      rank: rankMap.get(e.lineUserId) ?? fallback++,
      gamesPlayedToday: gamesToday.get(e.lineUserId) ?? 0,
      lastPlaceLastRound: lastPlaceSet.has(e.lineUserId),
    }));

    const result = generateRound(players);
    if (result.tables.length === 0) {
      return NextResponse.json({ error: "卓を組める人数がいません" }, { status: 400 });
    }

    // 卓を mahjongTables として作成（既存のスコア申告フローに乗る）
    const now = new Date().toISOString();
    const created: MahjongTable[] = [];
    const batch = db.batch();
    for (const tbl of result.tables) {
      const members: MahjongTableMember[] = tbl.members.map((p) => ({
        lineUserId: p.lineUserId,
        displayName: p.displayName,
        pictureUrl: p.pictureUrl || "",
        points: null,
        rank: null,
        reportedAt: null,
      }));
      const ref = db.collection("mahjongTables").doc();
      const data: Omit<MahjongTable, "tableId"> = {
        seasonId: season.seasonId,
        eventDate,
        createdBy: "system",
        memberIds: tbl.members.map((p) => p.lineUserId),
        members,
        status: "reporting",
        round: nextRound,
        tableLabel: tbl.label,
        createdAt: now,
        updatedAt: now,
      };
      batch.set(ref, data);
      created.push({ ...data, tableId: ref.id });
    }
    await batch.commit();

    return NextResponse.json(
      {
        round: nextRound,
        tables: created,
        spectators: result.spectators.map((s) => ({
          lineUserId: s.lineUserId,
          displayName: s.displayName,
          pictureUrl: s.pictureUrl,
        })),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[admin/mahjong/rounds] POST error:", error);
    return NextResponse.json({ error: "卓組みに失敗しました" }, { status: 500 });
  }
}
