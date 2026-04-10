import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { sendReservationReminder } from "@/lib/line";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * GET /api/cron/reminder
 * 5分ごとに Vercel Cron から呼び出され、
 * 25〜30分後に開始する予約のリマインド LINE 通知を送信する。
 *
 * 二重送信防止: 送信済みの予約には reminderSent: true をセットする。
 */
export async function GET(req: NextRequest) {
  // Cron 認証
  if (CRON_SECRET) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const now = dayjs().tz("Asia/Tokyo");
  // 25〜30分後の範囲（5分間隔で実行されるため）
  const from = now.add(25, "minute");
  const to = now.add(30, "minute");

  const db = getDb();
  let sentCount = 0;
  const errors: string[] = [];

  try {
    // 今日の日付に該当する confirmed 予約を取得
    const todayStr = now.format("YYYY-MM-DD");
    const tomorrowStr = now.add(1, "day").format("YYYY-MM-DD");

    // 今日と明日の予約を対象（日をまたぐリマインドに対応）
    const dates = [todayStr];
    if (now.hour() >= 23 && now.minute() >= 30) {
      dates.push(tomorrowStr);
    }

    for (const targetDate of dates) {
      const snap = await db
        .collection("reservations")
        .where("date", "==", targetDate)
        .where("status", "==", "confirmed")
        .get();

      for (const doc of snap.docs) {
        const data = doc.data();

        // 既にリマインド済みならスキップ
        if (data.reminderSent) continue;

        // 予約開始時刻を dayjs に変換
        const startDateTime = dayjs.tz(
          `${data.date} ${data.startTime}`,
          "YYYY-MM-DD HH:mm",
          "Asia/Tokyo"
        );

        // 25〜30分後の範囲内かチェック
        if (startDateTime.isAfter(from) && startDateTime.isBefore(to) || startDateTime.isSame(to)) {
          try {
            await sendReservationReminder(data.lineUserId, {
              facilityName: data.facilityName,
              date: data.date,
              startTime: data.startTime,
              endTime: data.endTime,
            });

            // 送信済みフラグを立てる
            await doc.ref.update({ reminderSent: true });
            sentCount++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`${doc.id}: ${msg}`);
            console.error(`[cron/reminder] Failed for ${doc.id}:`, err);
          }
        }
      }
    }
  } catch (err) {
    console.error("[cron/reminder] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  console.log(`[cron/reminder] Sent ${sentCount} reminders at ${now.format()}`);

  return NextResponse.json({
    success: true,
    sentCount,
    errors: errors.length > 0 ? errors : undefined,
    timestamp: now.format(),
  });
}
