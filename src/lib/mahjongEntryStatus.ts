/**
 * 麻雀参加エントリーの状態機械。サーバーで不正遷移を拒否するための単一定義。
 * reserved → paid → cancelRequested → refunded / cancelRejected
 *
 * ※ 状態名は内部表現。利用者向けラベルは別軸で扱う（「仮予約」は使わない）:
 *   reserved = 参加確定（未払い） / paid = 支払い済み（GM 卓振り分け対象）。
 *   POST 時点で参加確定＝定員8名・月ロックを消費する（reserved でも枠は確保済み）。
 */
export type MahjongEntryStatus =
  | "reserved"
  | "paid"
  | "cancelRequested"
  | "refunded"
  | "cancelRejected";

const ENTRY_STATUSES: MahjongEntryStatus[] = [
  "reserved",
  "paid",
  "cancelRequested",
  "refunded",
  "cancelRejected",
];

const TRANSITIONS: Record<MahjongEntryStatus, MahjongEntryStatus[]> = {
  reserved: ["paid"], // 決済で確定（未決済の取消はレコード削除＝状態遷移外）
  paid: ["cancelRequested"], // 支払い済みのキャンセル依頼
  cancelRequested: ["refunded", "cancelRejected"], // 管理者が返金 or 却下
  refunded: [], // 終端
  cancelRejected: ["cancelRequested"], // 却下後の再依頼は許容
};

export function canTransition(from: MahjongEntryStatus, to: MahjongEntryStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

function isMahjongEntryStatus(value: unknown): value is MahjongEntryStatus {
  return typeof value === "string" && ENTRY_STATUSES.includes(value as MahjongEntryStatus);
}

/** paymentStatus/status 未設定の旧データから現在状態を導出（後方互換）。 */
export function deriveStatus(e: { status?: string; paymentStatus?: string }): MahjongEntryStatus {
  if (isMahjongEntryStatus(e.status)) return e.status;
  if (e.paymentStatus === "paid") return "paid";
  if (e.paymentStatus === "cancelRequested") return "cancelRequested";
  return "reserved";
}
