import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason, isGameMaster } from "@/lib/mahjong";
import { ASSIGN_VALID_LABELS } from "@/lib/mahjongAssign";
import { advanceDayIfRoundComplete } from "@/lib/mahjongDay";
import { writeAuditLog } from "@/lib/auditLog";
import type { MahjongDayState, MahjongRotMember, MahjongTable } from "@/types";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * DELETE /api/mahjong/day/table
 * GM 専用: いまの半荘の指定卓を取り消す。
 * body: { eventDate, label: "A" | "B" }
 *
 * 欠員が出たのに気づかず3名で始めてしまった等のやり直し用。
 * - その卓のメンバーは待機（抜け番）へ戻す。申告済みの点数があっても破棄される。
 * - 残った卓だけで半荘は続く。**その半荘の卓が全て無くなったら** awaitingAssignment=true に戻し、
 *   GM が同じ半荘を組み直せるようにする。
 * - 半荘そのものは進めない（round は変えない）。
 */
export async function DELETE(req: NextRequest) {
  const userId = await requireGameUser(req);
  if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const season = await getActiveSeason("mahjong");
  if (!season) return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });
  if (!isGameMaster(season, userId)) {
    return NextResponse.json({ error: "ゲームマスターのみ利用できます" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const eventDate: unknown = body?.eventDate;
  const label: unknown = body?.label;
  if (typeof eventDate !== "string" || !DATE_RE.test(eventDate)) {
    return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
  }
  if (typeof label !== "string" || !ASSIGN_VALID_LABELS.includes(label)) {
    return NextResponse.json({ error: "卓の指定が不正です" }, { status: 400 });
  }

  const db = getDb();
  const dayRef = db.collection("mahjongDayState").doc(`${season.seasonId}_${eventDate}`);

  try {
    const result = await db.runTransaction(async (tx) => {
      const daySnap = await tx.get(dayRef);
      if (!daySnap.exists) return { status: 400 as const, error: "当日はまだ開始していません" };
      const day = daySnap.data() as MahjongDayState & { awaitingAssignment?: boolean };
      const round = day.round;

      const tblSnap = await tx.get(
        db
          .collection("mahjongTables")
          .where("seasonId", "==", season.seasonId)
          .where("eventDate", "==", eventDate)
      );
      const roundTables = tblSnap.docs
        .map((d) => ({ id: d.id, ref: d.ref, ...(d.data() as MahjongTable) }))
        .filter((t) => (t.round ?? 1) === round);

      const target = roundTables.find((t) => t.tableLabel === label);
      if (!target) return { status: 404 as const, error: `${label}卓はありません` };

      // 取り消した卓のメンバーは待機の末尾へ（重複させない）。
      const waiting: MahjongRotMember[] = [...(day.waiting ?? [])];
      const inWaiting = new Set(waiting.map((w) => w.lineUserId));
      for (const m of target.members) {
        if (inWaiting.has(m.lineUserId)) continue;
        waiting.push({ lineUserId: m.lineUserId, displayName: m.displayName, pictureUrl: m.pictureUrl ?? "" });
      }

      tx.delete(target.ref);

      const remaining = roundTables.filter((t) => t.id !== target.id);
      tx.set(dayRef, {
        ...day,
        waiting,
        tableLabels: remaining.map((t) => t.tableLabel ?? "?"),
        // 卓が全部無くなったら、この半荘を組み直せる状態へ戻す。
        awaitingAssignment: remaining.length === 0,
        updatedAt: new Date().toISOString(),
      });

      return {
        status: 200 as const,
        round,
        movedToWaiting: target.members.length,
        remainingTables: remaining.length,
      };
    });

    if (result.status !== 200) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    await writeAuditLog({
      eventType: "day.table_cancelled",
      actor: userId,
      target: { date: eventDate },
      meta: { round: result.round, label, movedToWaiting: result.movedToWaiting, remainingTables: result.remainingTables },
    });

    // 消した卓のせいで半荘の完了判定が誰にも走らなくなる場合がある
    // （残った卓が既に全員申告済み＝もう report が呼ばれない）。ここで進める。
    if (result.remainingTables > 0) {
      await advanceDayIfRoundComplete(season.seasonId, eventDate).catch((e) => {
        console.error("[mahjong/day/table] advance error:", e);
      });
    }

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[mahjong/day/table] DELETE error:", error);
    return NextResponse.json({ error: "卓の取り消しに失敗しました" }, { status: 500 });
  }
}
