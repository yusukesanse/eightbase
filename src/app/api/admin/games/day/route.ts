import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { writeAuditLog } from "@/lib/auditLog";
import { cancelDay } from "@/lib/mahjongForfeit";
import { cancelDartsDay } from "@/lib/dartsDay";
import { cancelBilliardsDay } from "@/lib/billiardsDay";
import { deriveStatus as deriveMahjong } from "@/lib/mahjongEntryStatus";
import { deriveStatus as deriveDarts } from "@/lib/dartsEntryStatus";
import { deriveStatus as deriveBilliards } from "@/lib/billiardsEntryStatus";

export const dynamic = "force-dynamic";

/**
 * 管理カレンダーの「開催日を休催（中止＝流会）にする」ための API（全ゲーム共通）。
 *  GET  ?gameCategory=&seasonId=&eventDate= … その日の参加者一覧＋休催(中止)済みか
 *  POST { gameCategory, seasonId, eventDate } … 休催化。支払い済みは返金対象(cancelRequested)へ回し、
 *         reserved は削除、月ロック解放、管理者へ返金依頼通知。cancelledDates 記録で以後の参加を止める。
 *
 * 「休催」は本アプリでは自動返金付き＝GM の「流会(cancel)」と同じ中身を管理者操作で発火させる。
 * 返金は Square で管理者が手動（ここでは対象化と通知のみ、金銭移動はしない）。
 */

type Game = "mahjong" | "darts" | "billiards";
const ENTRY_COL: Record<Game, string> = {
  mahjong: "mahjongEntries",
  darts: "dartsEntries",
  billiards: "billiardsEntries",
};
const CANCELLED_COL: Record<Game, string> = {
  mahjong: "mahjongCancelledDates",
  darts: "dartsCancelledDates",
  billiards: "billiardsCancelledDates",
};
// deriveStatus は3ゲームで同型（entry→"paid"|"reserved"|"cancelRequested"|"refunded"）。
const DERIVE: Record<Game, (e: Record<string, unknown>) => string> = {
  mahjong: (e) => deriveMahjong(e as never),
  darts: (e) => deriveDarts(e as never),
  billiards: (e) => deriveBilliards(e as never),
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (v: unknown): v is string =>
  typeof v === "string" && DATE_RE.test(v) && new Date(`${v}T00:00:00.000Z`).toISOString().slice(0, 10) === v;
const toGame = (v: unknown): Game | null =>
  v === "mahjong" || v === "darts" || v === "billiards" ? v : null;

/** 指定日の参加者と休催状態を返す。list=1 のときはこのシーズンの休催日一覧を返す。 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const game = toGame(sp.get("gameCategory"));
  const seasonId = sp.get("seasonId");
  const eventDate = sp.get("eventDate");
  if (!game || !seasonId) {
    return NextResponse.json({ error: "gameCategory / seasonId が必要です" }, { status: 400 });
  }
  const db = getDb();

  // 一覧モード: このシーズンの休催（中止）日を返す。カレンダーの色分け用。
  if (sp.get("list") === "1") {
    const snap = await db.collection(CANCELLED_COL[game]).where("seasonId", "==", seasonId).get();
    const closedDates = snap.docs.map((d) => (d.data().eventDate as string) || d.id).filter(Boolean);
    return NextResponse.json({ closedDates });
  }

  if (!isRealDate(eventDate)) {
    return NextResponse.json({ error: "eventDate が必要です" }, { status: 400 });
  }
  const [entrySnap, cancelSnap] = await Promise.all([
    db.collection(ENTRY_COL[game]).where("seasonId", "==", seasonId).where("eventDate", "==", eventDate).get(),
    db.collection(CANCELLED_COL[game]).doc(eventDate).get(),
  ]);
  const participants = entrySnap.docs
    .map((d) => d.data() as Record<string, unknown>)
    .map((e) => {
      const status = DERIVE[game](e);
      return {
        displayName: (e.displayName as string) || "ユーザー",
        pictureUrl: (e.pictureUrl as string) || "",
        status, // paid | reserved | cancelRequested | refunded
        paid: status === "paid",
        // 実決済者のみ返金対象（staff は免除＝paymentTransactionId 無し）。
        refundable: status === "paid" && !!e.paymentTransactionId,
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "ja"));
  const paidCount = participants.filter((p) => p.paid).length;
  const refundableCount = participants.filter((p) => p.refundable).length;
  return NextResponse.json({
    eventDate,
    closed: cancelSnap.exists,
    participants,
    counts: { total: participants.length, paid: paidCount, refundable: refundableCount },
  });
}

/** 指定日を休催（中止＝流会）にする。返金対象化・reserved削除・ロック解放・通知は cancel 関数が担う。 */
export async function POST(req: NextRequest) {
  const admin = await checkAdminAuth(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const game = toGame(body?.gameCategory);
  const seasonId: unknown = body?.seasonId;
  const eventDate: unknown = body?.eventDate;
  if (!game || typeof seasonId !== "string" || !seasonId || !isRealDate(eventDate)) {
    return NextResponse.json({ error: "gameCategory / seasonId / eventDate が必要です" }, { status: 400 });
  }

  const decidedBy = `admin:${admin}`;
  try {
    const result =
      game === "mahjong"
        ? await cancelDay(seasonId, eventDate, decidedBy)
        : game === "darts"
          ? await cancelDartsDay(seasonId, eventDate, decidedBy)
          : await cancelBilliardsDay(seasonId, eventDate, decidedBy);

    // 中止できない状態（進行中/終了済み/既に休催）は 409 で理由を返す。
    if (result.status === "started") {
      return NextResponse.json({ error: "卓が立っている（開催中）ため休催にできません" }, { status: 409 });
    }
    if (result.status === "finished") {
      return NextResponse.json({ error: "終了済みのため休催にできません" }, { status: 409 });
    }
    if (result.status === "closed") {
      return NextResponse.json({ error: "この日は既に休催です" }, { status: 409 });
    }
    if (result.status === "already") {
      return NextResponse.json({ success: true, already: true, eventDate });
    }
    // 休催＝実質は流会（返金あり）。既存の day.cancelled を再利用（actor が admin なら管理者操作と判る）。
    await writeAuditLog({ eventType: "day.cancelled", gameCategory: game, actor: admin, target: { date: eventDate } });
    return NextResponse.json({
      success: true,
      eventDate,
      paidCount: result.paidCount,
      refundCount: result.refundCount,
    });
  } catch (error) {
    console.error("[admin/games/day] POST error:", error);
    return NextResponse.json({ error: "休催の設定に失敗しました" }, { status: 500 });
  }
}
