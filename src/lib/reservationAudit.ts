/**
 * 予約運用の監査ログを reservationAuditLogs に記録する。
 * SwitchBot解錠の暫定運用（未連携/発行失敗）など、後追い調査用の記録。
 * 機密（token/secret/署名）は絶対に含めない。書き込み失敗しても本処理は止めない。
 */
import { getDb } from "@/lib/firebaseAdmin";

export type ReservationAuditEvent =
  | "unlock.issued" // 時限パスコード発行成功
  | "unlock.failed" // SwitchBot API 失敗（要手動再発行）
  | "unlock.manual" // SwitchBot未連携（deviceId未設定）→ 手動解錠運用
  | "unlock.rescheduled" // 予約日時の変更にあわせて有効期間を貼り替えた（パスコードは同じ）
  | "payment.refunded"; // 入金済の予約を「返金済」として記録した（Square の返金操作自体は管理画面で手動）

export interface ReservationAuditInput {
  eventType: ReservationAuditEvent;
  reservationId: string;
  facilityId?: string;
  reason?: string; // 失敗理由の要約（機密を含めない）
  actor?: string;  // 実行した管理者（メール）。人が金銭操作を行うイベントで必須級
}

export async function writeReservationAudit(input: ReservationAuditInput): Promise<void> {
  try {
    await getDb()
      .collection("reservationAuditLogs")
      .add({
        eventType: input.eventType,
        reservationId: input.reservationId,
        facilityId: input.facilityId ?? null,
        reason: input.reason ?? null,
        actor: input.actor ?? null,
        createdAt: new Date().toISOString(),
      });
  } catch {
    console.error("[reservationAudit] write failed:", input.eventType);
  }
}
