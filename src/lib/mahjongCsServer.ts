/**
 * CS 自動生成の遅延起動（サーバー）。
 * 管理者が確定した開催日になったら予選を自動生成して永続化する。
 * GET（管理/利用者）から呼ばれる。transaction で二重生成を防ぐ。
 */
import { getDb } from "@/lib/firebaseAdmin";
import { todayJst } from "@/lib/date";
import { startCsIfDue } from "@/lib/mahjongCs";
import { writeAuditLog } from "@/lib/auditLog";
import type { MahjongCsEvent } from "@/types";

type CsEvent = MahjongCsEvent & { csEventId: string };

export async function ensureCsStarted(event: CsEvent): Promise<CsEvent> {
  // 事前チェック（大半はここで即return＝無駄なtransactionを避ける）
  if (startCsIfDue(event, todayJst()) === null) return event;

  const db = getDb();
  const ref = db.collection("mahjongCsEvents").doc(event.csEventId);
  const applied = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const cur = snap.data() as MahjongCsEvent;
    const change = startCsIfDue(cur, todayJst());
    if (!change) return null;
    const updatedAt = new Date().toISOString();
    tx.update(ref, { rounds: change.rounds, status: change.status, updatedAt });
    return { ...change, updatedAt };
  });

  if (!applied) return event;
  await writeAuditLog({
    eventType: "cs.generated",
    actor: "system",
    target: { date: event.eventDate },
    beforeStatus: "setup",
    afterStatus: "running",
    meta: { csEventId: event.csEventId, entrants: event.entrants.length, rounds: applied.rounds.length },
  });
  return { ...event, rounds: applied.rounds, status: applied.status, updatedAt: applied.updatedAt };
}
