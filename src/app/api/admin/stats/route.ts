import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import dayjs from "dayjs";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/stats
 * 管理者向け統計情報 + 日別予約データを返す。
 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    const today = dayjs();
    const todayStr = today.format("YYYY-MM-DD");
    const monthStart = today.startOf("month").format("YYYY-MM-DD");

    // 過去30日分の日別集計用
    const thirtyDaysAgo = today.subtract(30, "day").format("YYYY-MM-DD");

    const [usersSnap, reservationsSnap, facilitiesSnap] = await Promise.all([
      db.collection("authorizedUsers").get(),
      db.collection("reservations").where("status", "==", "confirmed").get(),
      db.collection("facilities").where("active", "==", true).get(),
    ]);

    const totalUsers = usersSnap.size;
    const activeUsers = usersSnap.docs.filter((d) => d.data().active).length;

    const allReservations = reservationsSnap.docs.map((d) => d.data());
    const totalReservations = allReservations.length;
    const upcomingReservations = allReservations.filter((r) => r.date >= todayStr).length;
    const todayReservations = allReservations.filter((r) => r.date === todayStr).length;
    const reservationsThisMonth = allReservations.filter((r) => r.date >= monthStart).length;

    // 施設名マップ
    const facilityNames: Record<string, string> = {};
    facilitiesSnap.docs.forEach((doc) => {
      facilityNames[doc.id] = (doc.data().name as string) || doc.id;
    });

    // ── 日別予約データ（過去30日） ──
    const recentReservations = allReservations.filter(
      (r) => r.date >= thirtyDaysAgo && r.date <= todayStr
    );

    // 日別・施設別にカウント
    const dailyMap: Record<string, Record<string, number>> = {};
    for (let i = 29; i >= 0; i--) {
      const d = today.subtract(i, "day").format("YYYY-MM-DD");
      dailyMap[d] = {};
    }

    for (const r of recentReservations) {
      if (!dailyMap[r.date]) continue;
      const facilityId = r.facilityId || "unknown";
      dailyMap[r.date][facilityId] = (dailyMap[r.date][facilityId] || 0) + 1;
    }

    // フラットな配列に変換
    const dailyData = Object.entries(dailyMap).map(([date, facilities]) => {
      const total = Object.values(facilities).reduce((sum, n) => sum + n, 0);
      return { date, total, facilities };
    });

    // 施設別の累計（グラフの凡例用）
    const facilityTotals: Record<string, number> = {};
    for (const r of recentReservations) {
      const fid = r.facilityId || "unknown";
      facilityTotals[fid] = (facilityTotals[fid] || 0) + 1;
    }

    // 使われている施設IDリスト（多い順）
    const facilityIds = Object.entries(facilityTotals)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);

    return NextResponse.json({
      totalUsers,
      activeUsers,
      totalReservations,
      upcomingReservations,
      todayReservations,
      reservationsThisMonth,
      dailyData,
      facilityIds,
      facilityNames,
    });
  } catch (error) {
    console.error("[admin/stats] GET error:", error);
    return NextResponse.json({ error: "統計取得に失敗しました" }, { status: 500 });
  }
}
