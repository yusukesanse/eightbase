/**
 * 監査ログの表示ラベル（全ゲーム共通）。日本人が見て一目でわかるようにする。
 * - eventType → 日本語ラベル＋色＋補足説明
 * - status（遷移の before/after）→ 日本語ラベル
 * 管理画面の監査パネル（麻雀/ダーツ/ビリヤード）で共用する。
 */

export interface AuditEventLabel { text: string; color: string; desc: string }

/** 監査イベント種別 → 日本語ラベル（AuditEventType を全て網羅）。 */
export const AUDIT_EVENT_LABEL: Record<string, AuditEventLabel> = {
  "payment.cancelRequested": { text: "キャンセル依頼", color: "#a1502c", desc: "利用者が支払い済みの参加費をキャンセル依頼" },
  "refund.refunded": { text: "返金 完了", color: "#2f7d57", desc: "管理者が Square で返金し「返金済」にした" },
  "refund.rejected": { text: "返金 却下", color: "#5f6266", desc: "管理者がキャンセル依頼を却下（参加は継続）" },
  "schedule.closed": { text: "休催にした", color: "#c0563c", desc: "その開催日を休催（開催しない）に設定" },
  "schedule.reopened": { text: "休催を解除", color: "#1172a5", desc: "休催を取り消して通常開催に戻した" },
  "cs.generated": { text: "CS 自動生成", color: "#1172a5", desc: "締切日の到来でトーナメント表を自動生成" },
  "cs.matchEdited": { text: "CS 結果を修正", color: "#a1502c", desc: "管理者がCSの試合結果を手動修正" },
  "cs.reset": { text: "CS リセット", color: "#c0563c", desc: "管理者がCSブラケットをリセット" },
  "table.completed": { text: "卓・試合を確定", color: "#40434a", desc: "申告が揃い集計を確定" },
  "day.advanced": { text: "次へ進行", color: "#1172a5", desc: "抜け番などで次の半荘/回へ進行" },
  "day.started": { text: "ゲーム開始（受付締切）", color: "#2f7d57", desc: "GMが開始＝以降は参加・支払い不可" },
  "day.cancelled": { text: "開催中止（流会）", color: "#c0563c", desc: "GMが開催日を中止。支払い済みは返金対象へ" },
  "day.manual_assigned": { text: "卓・組を確定", color: "#1172a5", desc: "GMが手動で対戦組を確定" },
  "day.finished": { text: "本日終了", color: "#5f6266", desc: "GMが対局を終了＝当日成績を確定・以降記録不可" },
  "day.table_cancelled": { text: "卓を取り消し", color: "#c0563c", desc: "GMが卓を取消（その回をやり直し）" },
  "day.reset": { text: "当日リセット", color: "#c0563c", desc: "管理者が当日進行をリセット" },
};

/** eventType のラベル（未知の種別は種別文字列そのまま・グレー）。 */
export function auditEventLabel(eventType: string): AuditEventLabel {
  return AUDIT_EVENT_LABEL[eventType] ?? { text: eventType, color: "#5f6266", desc: "" };
}

/** 参加/決済などの状態値 → 日本語。遷移(before → after)表示に使う。 */
export const AUDIT_STATUS_LABEL: Record<string, string> = {
  reserved: "予約（未払い）",
  paid: "支払い済み",
  cancelRequested: "キャンセル依頼中",
  refunded: "返金済み",
  cancelRejected: "却下（参加継続）",
  pending: "未対応",
  rejected: "却下",
  refund: "返金",
  reject: "却下",
  reporting: "申告中",
  completed: "確定",
  awaiting: "受付中",
};

/** status 値の日本語表示（null/未定義は "—"、未知はそのまま返す）。 */
export function auditStatusLabel(status?: string | null): string {
  if (!status) return "—";
  return AUDIT_STATUS_LABEL[status] ?? status;
}
