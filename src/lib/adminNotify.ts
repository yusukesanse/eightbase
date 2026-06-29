/**
 * 管理者向け通知（Firestore `adminNotifications` に記録）。
 *
 * 解錠コード発行失敗・トレーラー予約取消（返金対応）などを管理webに伝えるための共通基盤。
 * 失敗しても呼び出し元の処理は止めない（通知の失敗で予約処理を巻き戻さない）。
 * ※ 管理web側の一覧表示UIは別途。本関数は記録（通知の発生源）を担う。
 */

import { getDb } from "@/lib/firebaseAdmin";
import dayjs from "dayjs";

export type AdminNotificationType =
  | "switchbot_failed" // 解錠コード発行失敗
  | "trailer_cancel"; // トレーラー予約の取消（手動返金対応依頼）

export async function notifyAdmin(
  type: AdminNotificationType,
  message: string,
  data: Record<string, unknown> = {}
): Promise<void> {
  try {
    const db = getDb();
    await db.collection("adminNotifications").add({
      type,
      message,
      data,
      read: false,
      createdAt: dayjs().toISOString(),
    });
  } catch (e) {
    console.error("[adminNotify] failed:", e);
  }
}
