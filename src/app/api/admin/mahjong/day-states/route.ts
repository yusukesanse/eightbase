import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getActiveSeason } from "@/lib/mahjong";
import { writeAuditLog } from "@/lib/auditLog";
import type { MahjongDayState, MahjongTable } from "@/types";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/admin/mahjong/day-states?seasonId=
 * 当日進行（抜け番）の状態一覧。現ラウンド・待機キュー・直近の交代を管理画面で確認する。
 * 利用者アプリと同一の mahjongDayState を参照＝表示が一致する。
 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let seasonId = req.nextUrl.searchParams.get("seasonId");
  if (!seasonId) {
    const season = await getActiveSeason();
    if (!season) return NextResponse.json({ dayStates: [] });
    seasonId = season.seasonId;
  }

  const snap = await getDb().collection("mahjongDayState").where("seasonId", "==", seasonId).get();
  const dayStates = snap.docs
    .map((d) => d.data() as MahjongDayState)
    .sort((a, b) => b.eventDate.localeCompare(a.eventDate));

  return NextResponse.json({ dayStates });
}

/**
 * DELETE /api/admin/mahjong/day-states?seasonId=&eventDate=
 * 障害時リセット: 当日の進行状態(dayState)とその日の卓を削除する。
 * 次に開催日へアクセスされた時点で、支払い済み参加者から再度自動生成される。
 */
export async function DELETE(req: NextRequest) {
  const admin = await checkAdminAuth(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let seasonId = req.nextUrl.searchParams.get("seasonId");
  const eventDate = req.nextUrl.searchParams.get("eventDate");
  if (!eventDate || !DATE_RE.test(eventDate)) {
    return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
  }
  if (!seasonId) {
    const season = await getActiveSeason();
    if (!season) return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });
    seasonId = season.seasonId;
  }

  const db = getDb();
  const batch = db.batch();
  batch.delete(db.collection("mahjongDayState").doc(`${seasonId}_${eventDate}`));
  const tbl = await db.collection("mahjongTables").where("seasonId", "==", seasonId).get();
  let removed = 0;
  tbl.docs.forEach((d) => {
    if ((d.data() as MahjongTable).eventDate === eventDate) {
      batch.delete(d.ref);
      removed += 1;
    }
  });
  await batch.commit();

  await writeAuditLog({ eventType: "day.reset", actor: admin, target: { date: eventDate }, meta: { removedTables: removed } });
  return NextResponse.json({ success: true, removedTables: removed });
}
