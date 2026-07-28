import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getActiveSeason } from "@/lib/mahjong";
import { ensurePokerCsStarted } from "@/lib/pokerCsServer";
import { isValidPokerDate } from "@/lib/pokerEntryValidation";
import type { PokerCsEvent } from "@/types/poker";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/poker/cs?seasonId= — CS一覧（新しい順）。締切到来分は自動生成して返す。
 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    let seasonId = req.nextUrl.searchParams.get("seasonId");
    if (!seasonId) {
      const season = await getActiveSeason("poker");
      if (!season) return NextResponse.json({ events: [], seasonId: null });
      seasonId = season.seasonId;
    }
    const snap = await getDb().collection("pokerCsEvents").where("seasonId", "==", seasonId).get();
    const events = await Promise.all(
      snap.docs
        .map((d) => ({ ...(d.data() as PokerCsEvent), csEventId: d.id }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((e) => ensurePokerCsStarted(e))
    );
    return NextResponse.json({ events, seasonId });
  } catch (error) {
    console.error("[admin/poker/cs] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

/**
 * POST /api/admin/poker/cs — CSを作成（誰でも参加可＝entrants は空で開始）。
 * body: { name, eventDate }（eventDate=エントリー締切＝自動ブラケット生成の起点）。
 */
export async function POST(req: NextRequest) {
  if (!(await checkAdminAuth(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const season = await getActiveSeason("poker");
    if (!season) return NextResponse.json({ error: "アクティブなポーカーシーズンがありません" }, { status: 400 });

    const body = await req.json().catch(() => null);
    const name: unknown = body?.name;
    const eventDate: unknown = body?.eventDate;
    if (typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "name は必須です" }, { status: 400 });
    }
    if (!isValidPokerDate(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const data: Omit<PokerCsEvent, "csEventId"> = {
      seasonId: season.seasonId,
      name: name.trim(),
      eventDate,
      status: "setup",
      entrants: [],
      rounds: [],
      championId: null,
      createdAt: now,
      updatedAt: now,
    };
    const docRef = await getDb().collection("pokerCsEvents").add(data);
    return NextResponse.json({ event: { csEventId: docRef.id, ...data } }, { status: 201 });
  } catch (error) {
    console.error("[admin/poker/cs] POST error:", error);
    return NextResponse.json({ error: "作成に失敗しました" }, { status: 500 });
  }
}
