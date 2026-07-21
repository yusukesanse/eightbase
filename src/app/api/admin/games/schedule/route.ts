import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { generateRecurringDates } from "@/lib/scheduleRecurrence";
import { DARTS_DEFAULT_START_TIME, DARTS_DEFAULT_END_TIME } from "@/types/darts";
import { BILLIARDS_DEFAULT_START_TIME, BILLIARDS_DEFAULT_END_TIME } from "@/types/billiards";

export const dynamic = "force-dynamic";

/**
 * 全ゲーム共通の日程API（管理・カレンダーUI用）。開催日を {game}Schedule の doc として管理する。
 *  GET    ?gameCategory=&seasonId=            … 開催日一覧（date 昇順・重複排除）
 *  POST   { gameCategory, seasonId, date }     … 開催日を1件追加（決定的ID・冪等）
 *  POST   { gameCategory, seasonId, bulk:true, startDate?, count? } … 既定日を一括投入
 *  DELETE ?gameCategory=&seasonId=&date=       … 開催日を1件削除（その日の doc を全消し）
 *
 * 麻雀は追加時に同日の休催(mahjongClosedDates)を解除する（土曜を戻したときの整合）。
 */

type Game = "mahjong" | "darts" | "billiards";
const CFG: Record<Game, { col: string; start: string; end: string; extra?: Record<string, unknown> }> = {
  mahjong: { col: "mahjongSchedule", start: "13:00", end: "18:00", extra: { type: "league" } },
  darts: { col: "dartsSchedule", start: DARTS_DEFAULT_START_TIME, end: DARTS_DEFAULT_END_TIME },
  billiards: { col: "billiardsSchedule", start: BILLIARDS_DEFAULT_START_TIME, end: BILLIARDS_DEFAULT_END_TIME },
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** YYYY-MM-DD かつ実在日付（UTC基準・繰り上がり/NaN を弾く）。 */
function isRealDate(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00.000Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}
function toGame(v: unknown): Game | null {
  return v === "mahjong" || v === "darts" || v === "billiards" ? v : null;
}
const schedId = (seasonId: string, date: string) => `${seasonId}_${date}`;

export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const game = toGame(req.nextUrl.searchParams.get("gameCategory"));
  const seasonId = req.nextUrl.searchParams.get("seasonId");
  if (!game || !seasonId) return NextResponse.json({ error: "gameCategory と seasonId が必要です" }, { status: 400 });

  const snap = await getDb().collection(CFG[game].col).where("seasonId", "==", seasonId).get();
  const set = new Set<string>();
  for (const d of snap.docs) {
    const x = d.data() as { date?: string; type?: string };
    if (x.type && x.type !== "league") continue;
    if (x.date) set.add(x.date);
  }
  return NextResponse.json({
    dates: Array.from(set).sort(),
    startTime: CFG[game].start,
    endTime: CFG[game].end,
  });
}

export async function POST(req: NextRequest) {
  if (!(await checkAdminAuth(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const game = toGame(body?.gameCategory);
  const seasonId: unknown = body?.seasonId;
  if (!game || typeof seasonId !== "string" || !seasonId) {
    return NextResponse.json({ error: "gameCategory と seasonId が必要です" }, { status: 400 });
  }
  const db = getDb();
  const cfg = CFG[game];
  const now = new Date().toISOString();
  const makeDoc = (date: string) => ({
    scheduleId: schedId(seasonId, date),
    seasonId,
    date,
    startTime: cfg.start,
    endTime: cfg.end,
    createdAt: now,
    ...(cfg.extra ?? {}),
  });

  // 一括投入（繰り返し設定）: 曜日 × 間隔（毎週/2週/3週…）× 期間。
  // 期間はシーズン開始日〜指定終了日（シーズン終了日でクランプ）。
  if (body?.bulk === true) {
    const season = (await db.collection("seasons").doc(seasonId).get()).data() as { startDate?: string; endDate?: string } | undefined;
    const weekday = Number(body?.weekday);
    const intervalWeeks = Number(body?.intervalWeeks);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      return NextResponse.json({ error: "weekday は 0（日）〜6（土）で指定してください" }, { status: 400 });
    }
    if (!Number.isInteger(intervalWeeks) || intervalWeeks < 1 || intervalWeeks > 8) {
      return NextResponse.json({ error: "intervalWeeks は 1〜8 で指定してください" }, { status: 400 });
    }
    // 開始日は指定 or シーズン開始日、終了日は指定 or シーズン終了日。シーズン範囲でクランプ。
    let start = isRealDate(body?.startDate) ? body.startDate : season?.startDate;
    let end = isRealDate(body?.endDate) ? body.endDate : season?.endDate;
    if (isRealDate(season?.startDate) && isRealDate(start) && start < season!.startDate!) start = season!.startDate;
    if (isRealDate(season?.endDate) && isRealDate(end) && end > season!.endDate!) end = season!.endDate;
    if (!isRealDate(start) || !isRealDate(end)) {
      return NextResponse.json({ error: "期間（startDate/endDate）が必要です。シーズンの期間を設定してください。" }, { status: 400 });
    }
    const dates = generateRecurringDates({ weekday, intervalWeeks, startDate: start, endDate: end });
    const batch = db.batch();
    for (const date of dates) batch.set(db.collection(cfg.col).doc(schedId(seasonId, date)), makeDoc(date));
    await batch.commit();
    return NextResponse.json({ success: true, added: dates.length, dates });
  }

  // 1件追加。
  const date: unknown = body?.date;
  if (!isRealDate(date)) return NextResponse.json({ error: "date が不正です" }, { status: 400 });
  await db.collection(cfg.col).doc(schedId(seasonId, date)).set(makeDoc(date));
  if (game === "mahjong") {
    // 土曜を開催に戻したときに旧「休催」doc が残っていると弾かれるため解除。
    await db.collection("mahjongClosedDates").doc(date).delete().catch(() => {});
  }
  return NextResponse.json({ success: true, date }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  if (!(await checkAdminAuth(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const game = toGame(req.nextUrl.searchParams.get("gameCategory"));
  const seasonId = req.nextUrl.searchParams.get("seasonId");
  const date = req.nextUrl.searchParams.get("date");
  if (!game || !seasonId || !isRealDate(date)) {
    return NextResponse.json({ error: "gameCategory / seasonId / date が必要です" }, { status: 400 });
  }
  const db = getDb();
  // 参加者がいる日は削除不可（返金対応が必要なため）。
  const entryCol = `${game}Entries`;
  const entrySnap = await db.collection(entryCol).where("seasonId", "==", seasonId).where("eventDate", "==", date).limit(1).get();
  if (!entrySnap.empty) return NextResponse.json({ error: "参加者がいるため削除できません" }, { status: 409 });

  // その日の schedule doc を全消し（決定的ID＋旧auto-ID両方）。
  const snap = await db.collection(CFG[game].col).where("seasonId", "==", seasonId).where("date", "==", date).get();
  const batch = db.batch();
  batch.delete(db.collection(CFG[game].col).doc(schedId(seasonId, date)));
  for (const d of snap.docs) batch.delete(d.ref);
  await batch.commit();
  return NextResponse.json({ success: true });
}
