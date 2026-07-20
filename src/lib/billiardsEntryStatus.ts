/**
 * ビリヤード参加エントリーの状態機械（ダーツ dartsEntryStatus を流用）。
 * reserved → paid → cancelRequested → refunded / cancelRejected
 */
export type BilliardsEntryStatus =
  | "reserved"
  | "paid"
  | "cancelRequested"
  | "refunded"
  | "cancelRejected";

const ENTRY_STATUSES: BilliardsEntryStatus[] = [
  "reserved",
  "paid",
  "cancelRequested",
  "refunded",
  "cancelRejected",
];

const TRANSITIONS: Record<BilliardsEntryStatus, BilliardsEntryStatus[]> = {
  reserved: ["paid"],
  paid: ["cancelRequested"],
  cancelRequested: ["refunded", "cancelRejected"],
  refunded: [],
  cancelRejected: ["cancelRequested"],
};

export function canTransition(from: BilliardsEntryStatus, to: BilliardsEntryStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

function isBilliardsEntryStatus(value: unknown): value is BilliardsEntryStatus {
  return typeof value === "string" && ENTRY_STATUSES.includes(value as BilliardsEntryStatus);
}

/** paymentStatus/status 未設定の旧データから現在状態を導出（後方互換）。 */
export function deriveStatus(e: { status?: string; paymentStatus?: string }): BilliardsEntryStatus {
  if (isBilliardsEntryStatus(e.status)) return e.status;
  if (e.paymentStatus === "paid") return "paid";
  if (e.paymentStatus === "cancelRequested") return "cancelRequested";
  return "reserved";
}
