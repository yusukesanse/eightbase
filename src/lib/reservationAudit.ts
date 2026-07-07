/**
 * 予約運用の監査ログを reservationAuditLogs に記録する。
 * SwitchBot解錠の暫定運用（未連携/発行失敗）など、後追い調査用の記録。
 * 機密（token/secret/署名）は絶対に含めない。書き込み失敗しても本処理は止めない。
 */
import { getDb } from "@/lib/firebaseAdmin";

export type ReservationAuditEvent =
  | "unlock.issued" // 時限パスコード発行成功
  | "unlock.failed" // SwitchBot API 失敗（要手動再発行）
  | "unlock.manual"; // SwitchBot未連携（deviceId未設定）→ 手動解錠運用

export interface ReservationAuditInput {
  eventType: ReservationAuditEvent;
  reservationId: string;
  facilityId?: string;
  reason?: string; // 失敗理由の要約（機密を含めない）
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
        createdAt: new Date().toISOString(),
      });
  } catch {
    console.error("[reservationAudit] write failed:", input.eventType);
  }
}
