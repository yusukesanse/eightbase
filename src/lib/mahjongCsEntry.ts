/**
 * 麻雀CS（新方式）の参加受付の純関数。
 * - 優先枠（作成時の M1・M2 = priorityUserIds）は表明すれば必ず参加確定。
 * - 受付中の M3 枠 = 定員 − 優先枠の人数（未表明の優先枠も席を確保しておく）。
 * - 締切後は、表明しなかった優先枠のぶんだけキャンセル待ちから先着順に繰り上げる。
 * 受付の全操作（表明・取り消し・定員変更・締切・管理者が外す）はこの rebalance を通す。
 */
import type { MahjongCsEntrant, MahjongCsEntry, MahjongCsEvent } from "@/types";

/** タイムゾーンを明示した、解釈可能な ISO 日時だけを受け付ける。 */
export function isIsoWithOffset(s: unknown): s is string {
  return typeof s === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(s)
    && Number.isFinite(Date.parse(s));
}

export function isManualCs(event: Pick<MahjongCsEvent, "capacity">): boolean {
  return typeof event.capacity === "number";
}

export interface RebalanceOptions {
  capacity: number;
  priorityUserIds: string[];
  phase: "entry" | "closed";
}

const byEnteredAt = (a: MahjongCsEntry, b: MahjongCsEntry) =>
  Date.parse(a.enteredAt) - Date.parse(b.enteredAt);

export function rebalanceEntries(entries: MahjongCsEntry[], opts: RebalanceOptions): MahjongCsEntry[] {
  const priority = new Set(opts.priorityUserIds);
  const sorted = [...entries].sort(byEnteredAt);
  const enteredPriority = sorted.filter((x) => priority.has(x.lineUserId)).length;
  const reserved = opts.phase === "entry" ? priority.size : enteredPriority;
  let budget = Math.max(0, opts.capacity - reserved);
  return sorted.map((x) => {
    if (priority.has(x.lineUserId)) return { ...x, state: "confirmed" };
    if (budget > 0) {
      budget--;
      return { ...x, state: "confirmed" };
    }
    return { ...x, state: "waitlisted" };
  });
}

export function waitlistPosition(entries: MahjongCsEntry[], lineUserId: string): number | null {
  const wl = [...entries].sort(byEnteredAt).filter((x) => x.state === "waitlisted");
  const i = wl.findIndex((x) => x.lineUserId === lineUserId);
  return i < 0 ? null : i + 1;
}

export function entrantsFromEntries(entries: MahjongCsEntry[]): MahjongCsEntrant[] {
  return [...entries].sort(byEnteredAt).filter((x) => x.state === "confirmed").map((x) => ({
    lineUserId: x.lineUserId,
    displayName: x.displayName,
    ...(x.pictureUrl ? { pictureUrl: x.pictureUrl } : {}),
    tier: x.tier,
    rank: x.rank,
    seed: false,
  }));
}

/** 締切時刻を過ぎていれば、締切後の状態（差分）を返す。まだなら null。 */
export function closeEntriesIfDue(event: MahjongCsEvent, nowIso: string): Partial<MahjongCsEvent> | null {
  if (event.status !== "entry" || !event.entryClosesAt) return null;
  const now = Date.parse(nowIso);
  const closesAt = Date.parse(event.entryClosesAt);
  if (Number.isNaN(now) || Number.isNaN(closesAt) || now < closesAt) return null;
  const entries = rebalanceEntries(event.entries ?? [], {
    capacity: event.capacity ?? 0,
    priorityUserIds: event.priorityUserIds ?? [],
    phase: "closed",
  });
  return { status: "closed", closedAt: nowIso, entries, entrants: entrantsFromEntries(entries) };
}
