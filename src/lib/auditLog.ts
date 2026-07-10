/**
 * 麻雀運用の監査ログを mahjongAuditLogs に一元記録する。
 * 状態変更API（返金/キャンセル/休催化/進行確定）は必ずここへ書き込む。
 * 監査は本処理を止めない（書き込み失敗はログのみ）。
 */
import { getDb } from "@/lib/firebaseAdmin";

export type AuditEventType =
  | "payment.cancelRequested" // 支払い済みのキャンセル依頼（利用者）
  | "refund.refunded" // 返金処理（管理者）
  | "refund.rejected" // キャンセル却下（管理者）
  | "schedule.closed" // 休催化（管理者）
  | "schedule.reopened" // 休催解除（管理者）
  | "cs.generated" // CS予選の自動生成（確定日到来・システム）
  | "cs.matchEdited" // CS試合結果の管理者修正
  | "cs.reset" // CSブラケットの管理者リセット
  | "table.completed" // 卓の集計確定（利用者申告が揃った）
  | "day.advanced" // 抜け番で次半荘へ進行（システム）
  | "day.started" // GM の「ゲーム開始」＝受付締切（参加表明・支払いを締める）
  | "day.manual_assigned" // GM による手動卓振り分けの確定
  | "day.reset"; // 当日進行の管理者リセット

export interface AuditLogInput {
  eventType: AuditEventType;
  actor: string; // 実行者: 管理者メール / 利用者 lineUserId / "system"
  target: { date?: string; entryId?: string; tableId?: string };
  beforeStatus?: string | null;
  afterStatus?: string | null;
  meta?: Record<string, unknown>;
}

export async function writeAuditLog(input: AuditLogInput): Promise<void> {
  try {
    await getDb()
      .collection("mahjongAuditLogs")
      .add({
        eventType: input.eventType,
        actor: input.actor,
        target: input.target ?? {},
        beforeStatus: input.beforeStatus ?? null,
        afterStatus: input.afterStatus ?? null,
        meta: input.meta ?? {},
        createdAt: new Date().toISOString(),
      });
  } catch (e) {
    console.error("[auditLog] write failed:", input.eventType, e);
  }
}
