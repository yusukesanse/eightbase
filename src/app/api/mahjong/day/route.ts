import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";
import { isProduction } from "@/lib/env";
import { getActiveSeason, toPublicMahjongTable, isManualAssignmentSeason, isGameMaster } from "@/lib/mahjong";
import { startDay } from "@/lib/mahjongDay";
import { advanceDemoDay, reportOneDemoDummy } from "@/dev-only/mahjongDemo";
import type { MahjongDayState, MahjongTable } from "@/types";

export const dynamic = "force-dynamic";

/**
 * 当日の抜け番進行。
 *  GET  ?eventDate= … 現ラウンドの卓＋待機キュー＋直近の交代結果（開催日は自動で卓組み）
 *  PATCH { eventDate, myRank? } … DEV-ONLY: デモの半荘進行（ダミー一括補完→次卓生成）
 *  PATCH { eventDate, step: true } … DEV-ONLY: ダミー1名分だけ申告を代行（進捗を1人ずつ確認）
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const jstToday = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());

export async function GET(req: NextRequest) {
  // 認証とアクティブシーズン取得は独立＝並列化。
  const [userId, season] = await Promise.all([requireGameUser(req), getActiveSeason()]);
  if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const eventDate = req.nextUrl.searchParams.get("eventDate");
  if (!eventDate || !DATE_RE.test(eventDate)) {
    return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
  }
  if (!season) return NextResponse.json({ round: 1, waiting: [], lastSwap: null, tables: [] });

  // 開催日を迎えていれば自動で卓組み（参加者4名以上・冪等。管理者操作不要）。
  if (eventDate <= jstToday()) {
    await startDay(season.seasonId, eventDate).catch(() => {});
  }

  const db = getDb();
  // dayState と 卓一覧は独立＝並列取得（startDay 後）。
  // 卓は eventDate で絞る（等値2条件なので複合インデックス不要）。当日画面は 12 秒ごとに
  // ポーリングされるため、シーズン全件を読むと開催を重ねるほど読み取りが膨らむ。
  const [daySnap, snap] = await Promise.all([
    db.collection("mahjongDayState").doc(`${season.seasonId}_${eventDate}`).get(),
    db
      .collection("mahjongTables")
      .where("seasonId", "==", season.seasonId)
      .where("eventDate", "==", eventDate)
      .get(),
  ]);
  const day = daySnap.exists ? (daySnap.data() as MahjongDayState & { awaitingAssignment?: boolean }) : null;
  const round = day?.round ?? 1;

  // 手動（GM）シーズン: 未確定 round は一般参加者に卓を見せない（GM の振り分け待ち）。
  const manualSeason = isManualAssignmentSeason(season);
  const gm = isGameMaster(season, userId);
  const awaitingAssignment = manualSeason ? (day?.awaitingAssignment ?? true) : false;

  const tables = manualSeason && awaitingAssignment
    ? []
    : snap.docs
        .map((d) => ({ ...(d.data() as MahjongTable), tableId: d.id }))
        .filter((t) => t.eventDate === eventDate && (t.round ?? 1) === round)
        .sort((a, b) => (a.tableLabel ?? "").localeCompare(b.tableLabel ?? ""))
        .map((t) => toPublicMahjongTable(t, userId));

  // 公開整形: 内部 lineUserId は返さない（tables は toPublicMahjongTable で秘匿済み）。
  const pub = (p: { displayName: string; pictureUrl?: string }) => ({ displayName: p.displayName, pictureUrl: p.pictureUrl ?? "" });
  const sw = day?.lastSwap;
  return NextResponse.json({
    round,
    waiting: manualSeason && awaitingAssignment ? [] : (day?.waiting ?? []).map((w) => ({ ...pub(w), isMe: w.lineUserId === userId })),
    lastSwap: sw ? { round: sw.round, out: sw.out.map(pub), in: sw.in.map(pub), shrunk: sw.shrunk, reason: sw.reason ?? null } : null,
    tables,
    manualSeason,
    isGameMaster: gm,
    awaitingAssignment,
    // GM が「本日の対局を終了」した日（以降この日の卓は組まれない）。
    finished: !!day?.finishedAt,
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
    // step=true: ダミー1名分だけ代行申告（GM パネルの申告進捗が1人ずつ増えるのを確認できる）。
    if (body?.step === true) {
      const result = await reportOneDemoDummy(season.seasonId, eventDate, userId);
      return NextResponse.json({ success: true, ...result });
    }
    const { swap } = await advanceDemoDay(season.seasonId, eventDate, userId, myRank);
    return NextResponse.json({ success: true, swap });
  } catch (error) {
    console.error("[mahjong/day] PATCH error:", error);
    return NextResponse.json({ error: "進行に失敗しました" }, { status: 500 });
  }
}
