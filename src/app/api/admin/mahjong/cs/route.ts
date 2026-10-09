import { writeAuditLog } from "@/lib/auditLog";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getActiveSeason } from "@/lib/mahjong";
import { isIsoWithOffset } from "@/lib/mahjongCsEntry";
import { ensureCsClosed } from "@/lib/mahjongCsServer";
import type {
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
    // 受付締切を過ぎた新方式の CS は参加者を確定する
    const closed = await Promise.all(events.map((e) => ensureCsClosed(e)));
    return NextResponse.json({ events: closed, seasonId });
  } catch (error) {
    console.error("[admin/mahjong/cs] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

/** 最新の確定編成の M1・M2 を作成時の優先枠として固定する。 */
async function fetchPriorityUserIds(db: ReturnType<typeof getDb>, seasonId: string) {
  const snap = await db.collection("mahjongLeagueAssignments")
    .where("seasonId", "==", seasonId).get();
  const assignments = snap.docs.map((d) => d.data() as MahjongLeagueAssignment)
    .sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt));
  return (assignments[0]?.entries ?? [])
    .filter((e) => e.tier === "M1" || e.tier === "M2")
    .map((e) => e.lineUserId);
}

/** POST /api/admin/mahjong/cs — 定員と受付期間を指定して作成する。 */
export async function POST(req: NextRequest) {
  const admin = await checkAdminAuth(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json().catch(() => null);
    const { name, eventDate, capacity, entryOpensAt, entryClosesAt } = body ?? {};
    if (typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "name は必須です" }, { status: 400 });
    }
    if (typeof eventDate !== "string" || !DATE_RE.test(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }
    if (!Number.isInteger(capacity) || capacity < 4 || capacity > 200) {
      return NextResponse.json({ error: "定員は4〜200の整数にしてください" }, { status: 400 });
    }
    if (!isIsoWithOffset(entryOpensAt) || !isIsoWithOffset(entryClosesAt)
      || Date.parse(entryClosesAt) <= Date.parse(entryOpensAt)) {
      return NextResponse.json({ error: "受付期間が不正です" }, { status: 400 });
    }
    const season = await getActiveSeason();
    if (!season) return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });
    const db = getDb();
    const priorityUserIds = await fetchPriorityUserIds(db, season.seasonId);
    if (capacity < priorityUserIds.length) {
      return NextResponse.json({ error: `定員が優先枠（M1・M2 の ${priorityUserIds.length} 名）より少なくなっています` }, { status: 400 });
    }
    const now = new Date().toISOString();
    const event: Omit<MahjongCsEvent, "csEventId"> = {
      seasonId: season.seasonId, name: name.trim(), eventDate, status: "entry",
      capacity, entryOpensAt, entryClosesAt, priorityUserIds, entries: [], entrants: [], rounds: [],
      createdAt: now, updatedAt: now,
    };
    const ref = db.collection("mahjongCsEvents").doc();
    await ref.set(event);
    await writeAuditLog({ eventType: "cs.created", actor: admin, target: { date: eventDate },
      afterStatus: "entry", meta: { csEventId: ref.id } });
    return NextResponse.json({ event: { ...event, csEventId: ref.id } }, { status: 201 });
  } catch (error) {
    console.error("[admin/mahjong/cs] POST error:", error);
    return NextResponse.json({ error: "作成に失敗しました" }, { status: 500 });
  }
}
