import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason, toPublicMahjongTable } from "@/lib/mahjong";
import type { MahjongDayState, MahjongTable } from "@/types";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/mahjong/day/snapshot?eventDate=YYYY-MM-DD
 * 「卓確定」表示用: 初回の卓組み（round1）のスナップショット。
 *  - tables: round1 の全卓（A/B・最大2卓）を公開整形（自分の卓に限定しない）
 *  - waiting: round1 の抜け番（待機）メンバー
 * ※ 参加タブの ?mine=1 は自分の卓・全ラウンドのため、B卓欠落・複数回戦混在になる。
 *   本エンドポイントは round1 の初期編成のみを返す。
 */
export async function GET(req: NextRequest) {
  const userId = await requireGameUser(req);
  if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const eventDate = req.nextUrl.searchParams.get("eventDate");
  if (!eventDate || !DATE_RE.test(eventDate)) {
    return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
  }

  const season = await getActiveSeason();
  if (!season) return NextResponse.json({ tables: [], waiting: [] });

  const db = getDb();
  const [snap, daySnap] = await Promise.all([
    db.collection("mahjongTables").where("seasonId", "==", season.seasonId).get(),
    db.collection("mahjongDayState").doc(`${season.seasonId}_${eventDate}`).get(),
  ]);

  const all = snap.docs
    .map((d) => ({ ...(d.data() as MahjongTable), tableId: d.id }))
    .filter((t) => t.eventDate === eventDate);

  // 初回卓組み（round1・卓ラベル順）。round 未設定の手動卓は round1 扱い。
  const round1 = all
    .filter((t) => (t.round ?? 1) === 1)
    .sort((a, b) => (a.tableLabel ?? "").localeCompare(b.tableLabel ?? ""));
  const seated = new Set(round1.flatMap((t) => t.members.map((m) => m.lineUserId)));

  // round1 の待機 = 当日の全参加者（全ラウンドの卓メンバー ∪ 現待機キュー）から round1 着席者を除いた集合。
  // （抜け番は半荘ごとに入れ替わるため、後続ラウンドの卓メンバーも参加者として拾う）
  const participants = new Map<string, { displayName: string; pictureUrl?: string }>();
  for (const t of all) {
    for (const m of t.members) {
      if (!participants.has(m.lineUserId)) participants.set(m.lineUserId, { displayName: m.displayName, pictureUrl: m.pictureUrl });
    }
  }
  const day = daySnap.exists ? (daySnap.data() as MahjongDayState) : null;
  for (const w of day?.waiting ?? []) {
    if (!participants.has(w.lineUserId)) participants.set(w.lineUserId, { displayName: w.displayName, pictureUrl: w.pictureUrl });
  }
  const waiting = Array.from(participants.entries())
    .filter(([id]) => !seated.has(id))
    .map(([id, p]) => ({ displayName: p.displayName, pictureUrl: p.pictureUrl ?? "", isMe: id === userId }));

  return NextResponse.json({
    tables: round1.map((t) => toPublicMahjongTable(t, userId)),
    waiting,
  });
}
