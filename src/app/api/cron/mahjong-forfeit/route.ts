import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cronAuth";
import { getActiveSeason } from "@/lib/mahjong";
import { forfeitDayIfInsufficient } from "@/lib/mahjongForfeit";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

export const dynamic = "force-dynamic";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * GET /api/cron/mahjong-forfeit
 * 10分ごとに Vercel Cron から実行。麻雀リーグの「当日」が締切（開始時刻）を過ぎても
 * 支払い済み参加者が4名に満たなければ、その開催日を人数不足で自動中止（流会）する。
 * 冪等（forfeitDayIfInsufficient 内の mahjongCancelledDates で二重実行防止）。
 * 要件: docs/麻雀リーグ-人数不足自動中止-要件定義.md。
 */
export async function GET(req: NextRequest) {
  const authError = checkCronAuth(req);
  if (authError) return authError;

  try {
    const season = await getActiveSeason("mahjong");
    if (!season) return NextResponse.json({ skipped: "no-active-season" });

    const startTime: unknown = season.mahjongStartTime;
    if (typeof startTime !== "string" || !TIME_RE.test(startTime)) {
      // 開始時刻＝支払い締切が未設定だと人数を確定できないため自動中止しない（運用で設定する前提）。
      console.warn("[cron/mahjong-forfeit] Season.mahjongStartTime 未設定のためスキップ");
      return NextResponse.json({ skipped: "no-start-time" });
    }

    const now = dayjs().tz("Asia/Tokyo");
    const todayStr = now.format("YYYY-MM-DD");
    const deadline = dayjs.tz(`${todayStr} ${startTime}`, "YYYY-MM-DD HH:mm", "Asia/Tokyo");
    if (now.isBefore(deadline)) {
      return NextResponse.json({ skipped: "before-deadline", eventDate: todayStr, deadline: deadline.format() });
    }

    const result = await forfeitDayIfInsufficient(season.seasonId, todayStr);
    console.log(`[cron/mahjong-forfeit] ${todayStr}:`, result);
    return NextResponse.json({ eventDate: todayStr, result, timestamp: now.format() });
  } catch (err) {
    console.error("[cron/mahjong-forfeit] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
