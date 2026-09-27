import { getDb } from "@/lib/firebaseAdmin";
import { notifyAdmin } from "@/lib/adminNotify";

export const CALENDAR_ALERT_THROTTLE_MS = 6 * 60 * 60 * 1000; // 6時間
const COLLECTION = "calendarAlerts";

/** 施設ごとに6時間に1回まで通知する。transaction で送信権を確保し、失敗しても表示を止めない。 */
export async function notifyCalendarUnreadable(
  facilityId: string,
  facilityName: string | undefined,
  nowMs: number = Date.now()
): Promise<void> {
  try {
    const db = getDb();
    const ref = db.collection(COLLECTION).doc(facilityId);
    const shouldNotify = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : undefined;
      const last = typeof data?.lastNotifiedAtMs === "number" ? data.lastNotifiedAtMs : undefined;
      if (last !== undefined && nowMs - last < CALENDAR_ALERT_THROTTLE_MS) return false;
      tx.set(ref, { facilityId, lastNotifiedAtMs: nowMs }, { merge: true });
      return true;
    });
    if (shouldNotify) {
      await notifyAdmin(
        "calendar_unreadable",
        `施設「${facilityName ?? facilityId}」のGoogleカレンダーが読み取れません。共有設定を確認してください。`,
        { facilityId }
      );
    }
  } catch (e) {
    console.error("[calendarAlert] failed:", e);
  }
}
