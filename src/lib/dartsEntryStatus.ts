/**
 * ダーツ参加エントリーの状態機械（麻雀 mahjongEntryStatus を流用）。
 * reserved → paid → cancelRequested → refunded / cancelRejected
 *
 * reserved = 参加確定（未払い）/ paid = 支払い済み。POST 時点で参加確定＝定員8名・月ロックを消費する。
 */
export type DartsEntryStatus =
  | "reserved"
  | "paid"
  | "cancelRequested"
  | "refunded"
  | "cancelRejected";

const ENTRY_STATUSES: DartsEntryStatus[] = [
  "reserved",
  "paid",
  "cancelRequested",
  "refunded",
  "cancelRejected",
];

const TRANSITIONS: Record<DartsEntryStatus, DartsEntryStatus[]> = {
  reserved: ["paid"],
  paid: ["cancelRequested"],
  cancelRequested: ["refunded", "cancelRejected"],
  refunded: [],
  cancelRejected: ["cancelRequested"],
};

export function canTransition(from: DartsEntryStatus, to: DartsEntryStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

function isDartsEntryStatus(value: unknown): value is DartsEntryStatus {
  return typeof value === "string" && ENTRY_STATUSES.includes(value as DartsEntryStatus);
}

/** paymentStatus/status 未設定の旧データから現在状態を導出（後方互換）。 */
export function deriveStatus(e: { status?: string; paymentStatus?: string }): DartsEntryStatus {
  if (isDartsEntryStatus(e.status)) return e.status;
  if (e.paymentStatus === "paid") return "paid";
  if (e.paymentStatus === "cancelRequested") return "cancelRequested";
  return "reserved";
}
