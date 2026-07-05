/**
 * 麻雀参加エントリーの状態機械。サーバーで不正遷移を拒否するための単一定義。
 * reserved(仮予約) → paid(確定) → cancelRequested(依頼) → refunded(返金) / cancelRejected(却下)
 */
export type MahjongEntryStatus =
  | "reserved"
  | "paid"
  | "cancelRequested"
  | "refunded"
  | "cancelRejected";

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

/** paymentStatus/status 未設定の旧データから現在状態を導出（後方互換）。 */
export function deriveStatus(e: { status?: string; paymentStatus?: string }): MahjongEntryStatus {
  if (e.status) return e.status as MahjongEntryStatus;
  if (e.paymentStatus === "paid") return "paid";
  if (e.paymentStatus === "cancelRequested") return "cancelRequested";
  return "reserved";
}
