import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";
import { isProduction } from "@/lib/env";
import { getActiveSeason, toPublicMahjongTable } from "@/lib/mahjong";
import { advanceDemoDay } from "@/dev-only/mahjongDemo";
import type { MahjongDayState, MahjongTable } from "@/types";

export const dynamic = "force-dynamic";

/**
 * DEV-ONLY（develop 専用 / main へ入れない）
 * 当日の抜け番進行（デモ検証専用・非本番）。
 *  GET  ?eventDate=YYYY-MM-DD … 現ラウンドの卓＋待機キュー＋直近の交代結果
 *  PATCH { eventDate, myRank? } … 現ラウンドを確定→抜け番で次半荘を自動生成
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  if (isProduction()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const userId = await requireGameUser(req);
  if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const eventDate = req.nextUrl.searchParams.get("eventDate");
  if (!eventDate || !DATE_RE.test(eventDate)) {
    return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
  }
  const season = await getActiveSeason();
  if (!season) return NextResponse.json({ round: 1, waiting: [], lastSwap: null, tables: [] });

  const db = getDb();
  const daySnap = await db.collection("mahjongDayState").doc(`${season.seasonId}_${eventDate}`).get();
  const day = daySnap.exists ? (daySnap.data() as MahjongDayState) : null;
  const round = day?.round ?? 1;

  const snap = await db.collection("mahjongTables").where("seasonId", "==", season.seasonId).get();
  const tables = snap.docs
    .map((d) => ({ ...(d.data() as MahjongTable & { demoDummy?: boolean }), tableId: d.id }))
    .filter((t) => t.eventDate === eventDate && (t.round ?? 1) === round && t.demoDummy)
    .sort((a, b) => (a.tableLabel ?? "").localeCompare(b.tableLabel ?? ""))
    .map((t) => toPublicMahjongTable(t, userId));

  return NextResponse.json({
    round,
    waiting: (day?.waiting ?? []).map((w) => ({ ...w, isMe: w.lineUserId === userId })),
    lastSwap: day?.lastSwap ?? null,
    tables,
  });
}

export async function PATCH(req: NextRequest) {
  if (isProduction()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const userId = await requireGameUser(req);
  if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const eventDate: unknown = body?.eventDate;
  if (typeof eventDate !== "string" || !DATE_RE.test(eventDate)) {
    return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
  }
  const myRank = Number.isInteger(body?.myRank) ? (body.myRank as number) : undefined;

  const season = await getActiveSeason();
  if (!season) return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });

  try {
    const { swap } = await advanceDemoDay(season.seasonId, eventDate, userId, myRank);
    return NextResponse.json({ success: true, swap });
  } catch (error) {
    console.error("[mahjong/day] PATCH error:", error);
    return NextResponse.json({ error: "進行に失敗しました" }, { status: 500 });
  }
}
