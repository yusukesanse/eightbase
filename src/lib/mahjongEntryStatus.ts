/**
 * 麻雀参加エントリーの状態機械。サーバーで不正遷移を拒否するための単一定義。
 * reserved → paid → cancelRequested → refunded / cancelRejected
 *
 * ※ 状態名は内部表現。利用者に見せる状態は「未参加 / お支払い確認中 / 参加確定」の3つだけ（WP2）。
 *   reserved + paymentStatus:"pending" = お支払い確認中（15分の仮押さえ・席を保持）
 *   paid = 参加確定（支払い済み。staff は免除で最初から paid）
 *   ※ 「参加確定（未払い）」は廃止した。席を持つかどうかは {@link isActiveMahjongEntry} で判定する。
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

/**
 * 「席（定員8名の枠）と月1回の枠を保持しているエントリー」か（WP2: 参加＝支払い）。
 *
 * ■ なぜ必要か
 *   「参加する」= Square のお支払いへ進む に変えたため、entry は作成直後から
 *   `paymentStatus:"pending"`（15分の仮押さえ）になる。支払わずに放置された pending が
 *   席を占め続けると、定員8名も月1回制限も「幽霊の参加者」で埋まってしまう。
 *   逆に pending の間に他人へ席を明け渡すと、支払い完了しても座れない。
 *   → **有効なのは「支払い済み」「期限内の仮押さえ」「返金対応中（席は保持）」だけ**。
 *
 * ■ 数えない
 *   - 期限切れの pending（仮押さえ解除＝未参加に戻る）
 *   - `reserved`（旧データ。「参加確定（未払い）」は廃止したので席を持たない）
 *   - `refunded` / `cancelRejected`（終端）
 *
 * 定員判定・月1回判定・参加者一覧（GET）はすべてこの関数で数えること。
 * 片方だけ別の数え方にすると「画面は満員なのに参加できる」等がすぐ起きる。
 */
export function isActiveMahjongEntry(
  e: { status?: string; paymentStatus?: string; pendingExpiresAt?: string | null },
  now: Date = new Date()
): boolean {
  const status = deriveStatus(e);
  // 支払い済み（staff の免除 paid を含む）と返金対応中は席を保持する。
  if (status === "paid" || status === "cancelRequested") return true;
  // 仮押さえは期限内だけ。期限ちょうど（==）は失効扱い＝席を返す。
  if (e.paymentStatus === "pending" && e.pendingExpiresAt) {
    return new Date(e.pendingExpiresAt).getTime() > now.getTime();
  }
  return false;
}
