/** CS参加受付の遅延締切（管理・利用者GETから呼び、transactionで二重更新を防ぐ）。 */
import { getDb } from "@/lib/firebaseAdmin";
import { closeEntriesIfDue, isManualCs } from "@/lib/mahjongCsEntry";
import { writeAuditLog } from "@/lib/auditLog";
import type { MahjongCsEvent } from "@/types";

type CsEvent = MahjongCsEvent & { csEventId: string };

export async function ensureCsClosed(event: CsEvent): Promise<CsEvent> {
  if (!isManualCs(event) || closeEntriesIfDue(event, new Date().toISOString()) === null) return event;

  const db = getDb();
  const ref = db.collection("mahjongCsEvents").doc(event.csEventId);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { event, applied: false };
    const cur = { ...(snap.data() as MahjongCsEvent), csEventId: event.csEventId };
    const now = new Date().toISOString();
    const change = isManualCs(cur) ? closeEntriesIfDue(cur, now) : null;
    if (!change) return { event: cur, applied: false };
    const update = { ...change, updatedAt: now };
    tx.update(ref, update);
    return { event: { ...cur, ...update }, applied: true };
  });

  if (result.applied) {
    await writeAuditLog({
      eventType: "cs.entryClosed",
      actor: "system",
      target: { date: result.event.eventDate },
      beforeStatus: "entry",
      afterStatus: "closed",
      meta: { csEventId: event.csEventId, entrants: result.event.entrants.length },
    });
  }
  return result.event;
}

/** 単一の配列インデックスを使い、シーズンと確定状態はメモリで絞る。 */
export async function hasPlayedMahjongLeague(seasonId: string, lineUserId: string): Promise<boolean> {
  const snap = await getDb().collection("mahjongTables")
    .where("memberIds", "array-contains", lineUserId).get();
  return snap.docs.some((doc) => {
    const table = doc.data();
    return table.seasonId === seasonId && table.status === "completed";
  });
}
