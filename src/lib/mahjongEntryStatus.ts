/**
 * 麻雀参加エントリーの状態機械。サーバーで不正遷移を拒否するための単一定義。
 * reserved → paid → cancelRequested → refunded / cancelRejected
 *
 * ※ 状態名は内部表現。利用者に見せる状態は「未参加 / お支払い確認中 / 未払い / 参加確定」。
 *   reserved + 期限内の paymentStatus:"pending" = お支払い確認中（15分の仮押さえ）
 *   reserved（paymentStatus なし／期限切れの pending） = 未払い（2026-09-11: 席は保持する）
 *   paid = 参加確定（支払い済み。staff は免除で最初から paid）
 *   席を持つかどうかは {@link isActiveMahjongEntry}、未払いかは {@link isUnpaidMahjongEntry} で判定する。
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
 * 「席（定員8名の枠）と月1回の枠を保持しているエントリー」か。
 *
 * ■ 2026-09-11 の決定（WP2 の「期限切れの仮押さえは席を返す」を撤回）
 *   WP2（2026-09-07）では、支払わずに放置された pending が席を占め続けると定員も月1回制限も
 *   「幽霊の参加者」で埋まるため、期限内の仮押さえだけを有効にしていた。
 *   しかしその結果、支払い前の人が本人にも他の参加者にも見えなくなり「予約したのに消えた」が続出した。
 *   → **参加表明した時点で席を持つ**（旧UIと同じ）。支払い前は「未払い」と表示して支払いを促す。
 *   払わない人で満員になり得るリスクは、表示の分かりやすさを優先して受け入れた。
 *   来ない・払わない人は本人の「参加をやめる」か、管理画面の参加者削除で外す。
 *
 * ■ 席を持つ: paid / cancelRequested（返金対応中も席は保持） / reserved（未払い・お支払い確認中）
 * ■ 持たない: refunded / cancelRejected（終端）
 *
 * 定員判定・月1回判定・参加者一覧（GET）はすべてこの関数で数えること。
 * 片方だけ別の数え方にすると「画面は満員なのに参加できる」等がすぐ起きる。
 */
export function isActiveMahjongEntry(e: {
  status?: string;
  paymentStatus?: string;
  pendingExpiresAt?: string | null;
}): boolean {
  const status = deriveStatus(e);
  return status === "paid" || status === "cancelRequested" || status === "reserved";
}

/** 期限内の仮押さえ（お支払い確認中）か。期限ちょうど（==）は失効扱い。 */
export function isPendingMahjongEntry(
  e: { paymentStatus?: string; pendingExpiresAt?: string | null },
  now: Date = new Date()
): boolean {
  return (
    e.paymentStatus === "pending" &&
    !!e.pendingExpiresAt &&
    new Date(e.pendingExpiresAt).getTime() > now.getTime()
  );
}

/**
 * 席は持つが支払いが済んでいない（旧 reserved／期限切れの仮押さえ）。
 * ⚠️ この状態の人に支払いへ進ませるときは、保存済みの paymentUrl を使わず**必ず新しいリンクを発行し直す**。
 *   期限切れの古い注文で払うと complete が 410 を返して返金対応になる（2026-08-03 と同じ構図）。
 */
export function isUnpaidMahjongEntry(
  e: { status?: string; paymentStatus?: string; pendingExpiresAt?: string | null },
  now: Date = new Date()
): boolean {
  return deriveStatus(e) === "reserved" && !isPendingMahjongEntry(e, now);
}
