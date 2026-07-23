/**
 * ポーカー参加エントリーの状態機械（ダーツ/ビリヤード entryStatus を流用）。
 * reserved → paid → cancelRequested → refunded / cancelRejected
 */
export type PokerEntryStatus =
  | "reserved"
  | "paid"
  | "cancelRequested"
  | "refunded"
  | "cancelRejected";

const ENTRY_STATUSES: PokerEntryStatus[] = [
  "reserved",
  "paid",
  "cancelRequested",
  "refunded",
  "cancelRejected",
];

const TRANSITIONS: Record<PokerEntryStatus, PokerEntryStatus[]> = {
  reserved: ["paid"],
  paid: ["cancelRequested"],
  cancelRequested: ["refunded", "cancelRejected"],
  refunded: [],
  cancelRejected: ["cancelRequested"],
};

export function canTransition(from: PokerEntryStatus, to: PokerEntryStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

function isPokerEntryStatus(value: unknown): value is PokerEntryStatus {
  return typeof value === "string" && ENTRY_STATUSES.includes(value as PokerEntryStatus);
}

/** paymentStatus/status 未設定の旧データから現在状態を導出（後方互換）。 */
export function deriveStatus(e: { status?: string; paymentStatus?: string }): PokerEntryStatus {
  if (isPokerEntryStatus(e.status)) return e.status;
  if (e.paymentStatus === "paid") return "paid";
  if (e.paymentStatus === "cancelRequested") return "cancelRequested";
  return "reserved";
}
