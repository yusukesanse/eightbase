import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { getFacilityById } from "@/lib/facilities";
import { requireMember } from "@/lib/auth";
import { getBlockingLockedSlots } from "@/lib/reservations";
import { dayOfWeek } from "@/lib/date";
import dayjs from "dayjs";

export const dynamic = "force-dynamic";

/**
 * 1週間分（月曜起点の7日間）の予約済みスロットを取得する。
 * 施設の availableDays に含まれない日は空配列を返す。
 * Query: facilityId, weekStart (YYYY-MM-DD の月曜日)
 * Response: { [date: string]: { start: string; end: string }[] }
 */
export async function GET(req: NextRequest) {
  const userId = await requireMember(req);
  if (!userId) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const facilityId = searchParams.get("facilityId");
  const weekStart  = searchParams.get("weekStart"); // YYYY-MM-DD (月曜)

  if (facilityId && weekStart && !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return NextResponse.json(
      { error: "weekStart は YYYY-MM-DD 形式で指定してください" },
      { status: 400 }
    );
  }
  if (!facilityId || !weekStart) {
    return NextResponse.json(
      { error: "facilityId and weekStart are required" },
      { status: 400 }
    );
  }

  const facility = await getFacilityById(facilityId);
  if (!facility) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  const availableDays = facility.availableDays ?? [1, 2, 3, 4, 5];
  const nowIso = dayjs().toISOString();
  const db = getDb();

  try {
    // 月曜起点の7日分を並列取得（利用不可曜日は空配列）
    const result: Record<string, { start: string; end: string }[]> = {};

    await Promise.all(
      Array.from({ length: 7 }, (_, i) => {
        const date = dayjs(weekStart).add(i, "day").format("YYYY-MM-DD");
        // 曜日判定は UTC 正午基準（本番 TZ=UTC 対策・CLAUDE.md）。
        if (!availableDays.includes(dayOfWeek(date))) {
          result[date] = [];
          return Promise.resolve();
        }
        // 空きの源は Firestore の reservationLocks（confirmed ＋ 未失効 pending）に一本化。
        return getBlockingLockedSlots(db, facilityId, date, nowIso).then((slots) => {
          result[date] = slots;
        });
      })
    );

    // 空き状況は常に最新を返す（HTTPキャッシュ禁止）
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[week-availability] error:", message);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message },
      { status: 500 }
    );
  }
}
