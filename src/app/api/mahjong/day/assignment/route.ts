import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason, isGameMaster } from "@/lib/mahjong";
import { startDay, buildInitialDay } from "@/lib/mahjongDay";
import { isAssignmentLocked } from "@/lib/mahjongAssign";
import { deriveStatus } from "@/lib/mahjongEntryStatus";
import type { MahjongDayState, MahjongEntry, MahjongTable } from "@/types";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const todayJst = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());

/**
 * GET /api/mahjong/day/assignment?eventDate=YYYY-MM-DD
 * GM（ゲームマスター）専用: 当日の支払い済みプール・現 round・下書き（既存 or FIFO 提案）・
 * ロック状態（申告開始済みか）を返す。非 GM は 403。
 */
export async function GET(req: NextRequest) {
  const userId = await requireGameUser(req);
  if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const eventDate = req.nextUrl.searchParams.get("eventDate");
  if (!eventDate || !DATE_RE.test(eventDate)) {
    return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
  }

  const season = await getActiveSeason();
  if (!season) return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });
  if (!isGameMaster(season, userId)) {
    return NextResponse.json({ error: "ゲームマスターのみ利用できます" }, { status: 403 });
  }

  // 開催日を迎えていれば dayState を用意（GM シーズンは卓を作らず awaiting 初期化）。
  if (eventDate <= todayJst()) {
    await startDay(season.seasonId, eventDate).catch(() => {});
  }

  const db = getDb();
  // eventDate で絞る（等値2条件なので複合インデックス不要）。シーズン全件を読むと
  // 開催を重ねるほど読み取りが増える。
  const [daySnap, entrySnap, tblSnap] = await Promise.all([
    db.collection("mahjongDayState").doc(`${season.seasonId}_${eventDate}`).get(),
    db.collection("mahjongEntries").where("seasonId", "==", season.seasonId).where("eventDate", "==", eventDate).get(),
    db.collection("mahjongTables").where("seasonId", "==", season.seasonId).where("eventDate", "==", eventDate).get(),
  ]);

  const day = daySnap.exists ? (daySnap.data() as MahjongDayState & { awaitingAssignment?: boolean }) : null;
  const round = day?.round ?? 1;
  const awaitingAssignment = day?.awaitingAssignment ?? true;

  // 支払い済みプール（enteredAt 昇順＝FIFO）
  const pool = entrySnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as MahjongEntry) }))
    .filter((e) => e.eventDate === eventDate && deriveStatus(e) === "paid")
    .sort((a, b) => (a.enteredAt ?? "").localeCompare(b.enteredAt ?? ""))
    .map((e) => ({ lineUserId: e.lineUserId, displayName: e.displayName, pictureUrl: e.pictureUrl ?? "" }));

  const roundTables = tblSnap.docs
    .map((d) => d.data() as MahjongTable)
    .filter((t) => t.eventDate === eventDate && (t.round ?? 1) === round)
    .sort((a, b) => (a.tableLabel ?? "").localeCompare(b.tableLabel ?? ""));

  // 未確定（awaitingAssignment=true）の round に残る卓は自動進行時代の残骸。
  // ロックにも下書きにも使わない（isAssignmentLocked の説明を参照）。
  const staleTables = awaitingAssignment;
  const locked = isAssignmentLocked(awaitingAssignment, roundTables);

  // 下書き: 確定済み round は既存卓（申告前なら編集可）、未確定 round は FIFO プレビュー。
  let draftTables: { label: string; memberIds: string[] }[];
  let draftWaiting: string[];
  if (!staleTables && roundTables.length > 0) {
    draftTables = roundTables.map((t) => ({ label: t.tableLabel ?? "?", memberIds: t.memberIds ?? t.members.map((m) => m.lineUserId) }));
    draftWaiting = (day?.waiting ?? []).map((w) => w.lineUserId);
  } else {
    const preview = buildInitialDay(pool);
    draftTables = preview.tables.map((t) => ({ label: t.label, memberIds: t.members.map((m) => m.lineUserId) }));
    draftWaiting = preview.waiting.map((m) => m.lineUserId);
  }

  // 確定済み round の進行状況（GM 画面は確定後これだけを畳んで表示し、
  // 全員の申告が済んで次 round へ進むと再び振り分け UI に戻る）。
  const progress = staleTables
    ? null
    : {
        tables: roundTables.map((t) => ({
          label: t.tableLabel ?? "?",
          members: t.members.map((m) => ({
            displayName: m.displayName,
            reported: m.rank != null || !!m.reportedAt,
          })),
        })),
        reported: roundTables.reduce(
          (n, t) => n + t.members.filter((m) => m.rank != null || m.reportedAt).length,
          0
        ),
        total: roundTables.reduce((n, t) => n + t.members.length, 0),
      };

  return NextResponse.json({
    round,
    awaitingAssignment,
    locked,
    // GM が「ゲーム開始」を押したか（＝受付締切済み）。未開始なら卓は組めない。
    started: !!day?.entryClosedAt,
    // GM が「本日の対局を終了」したか。以降この日の卓は組めない。
    finished: !!day?.finishedAt,
    pool,
    draft: { tables: draftTables, waiting: draftWaiting },
    progress,
  });
}
