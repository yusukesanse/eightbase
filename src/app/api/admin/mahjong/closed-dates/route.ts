import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { writeAuditLog } from "@/lib/auditLog";

export const dynamic = "force-dynamic";

/**
 * 麻雀の休催日（任意の曜日の開催を個別に止める）。クリックでトグルする前提。
 *  GET    … 休催日一覧
 *  POST   { date } … 休催にする（曜日不問）
 *  DELETE ?date= … 開催に戻す
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (d: string) => {
  const t = Date.parse(`${d}T12:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d;
};

export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const snap = await getDb().collection("mahjongClosedDates").get();
  const dates = snap.docs.map((d) => (d.data().date as string) || d.id).filter(Boolean);
  return NextResponse.json({ dates });
}

export async function POST(req: NextRequest) {
  const admin = await checkAdminAuth(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const date: unknown = body?.date;
  if (typeof date !== "string" || !DATE_RE.test(date) || !isRealDate(date)) {
    return NextResponse.json({ error: "実在する日付を指定してください" }, { status: 400 });
  }
  const db = getDb();
  await db.collection("mahjongClosedDates").doc(date).set({ date, closedAt: new Date().toISOString() });
  // 既存参加者を返金対応の判断材料として返す（休催後は startDay で卓を組まない）。
  const entries = (await db.collection("mahjongEntries").where("eventDate", "==", date).get()).docs.map((d) => d.data());
  const paid = entries.filter((e) => e.paymentStatus === "paid" || e.status === "paid").length;
  await writeAuditLog({ eventType: "schedule.closed", actor: admin, target: { date }, meta: { affected: entries.length, paid } });
  return NextResponse.json({ success: true, affected: { total: entries.length, paid } });
}

export async function DELETE(req: NextRequest) {
  const admin = await checkAdminAuth(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const date = req.nextUrl.searchParams.get("date");
  if (!date || !DATE_RE.test(date)) return NextResponse.json({ error: "date が不正です" }, { status: 400 });
  await getDb().collection("mahjongClosedDates").doc(date).delete();
  await writeAuditLog({ eventType: "schedule.reopened", actor: admin, target: { date } });
  return NextResponse.json({ success: true });
}
