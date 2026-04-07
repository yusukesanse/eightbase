import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import dayjs from "dayjs";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/stats
 * 管理者向け統計情報 + 各種グラフデータを返す。
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
    const thirtyDaysAgo = today.subtract(30, "day").format("YYYY-MM-DD");

    const [
      usersSnap,
      reservationsSnap,
      facilitiesSnap,
      questsSnap,
      eventsSnap,
    ] = await Promise.all([
      db.collection("authorizedUsers").get(),
      db.collection("reservations").where("status", "==", "confirmed").get(),
      db.collection("facilities").where("active", "==", true).get(),
      db.collection("quests").get(),
      db.collection("events").get(),
    ]);

    // ── 基本KPI ──
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

    // ── 1. 日別予約データ（過去30日） ──
    const recentReservations = allReservations.filter(
      (r) => r.date >= thirtyDaysAgo && r.date <= todayStr
    );

    const dailyMap: Record<string, Record<string, number>> = {};
    for (let i = 29; i >= 0; i--) {
      dailyMap[today.subtract(i, "day").format("YYYY-MM-DD")] = {};
    }

    for (const r of recentReservations) {
      if (!dailyMap[r.date]) continue;
      const fid = r.facilityId || "unknown";
      dailyMap[r.date][fid] = (dailyMap[r.date][fid] || 0) + 1;
    }

    const dailyData = Object.entries(dailyMap).map(([date, facilities]) => {
      const total = Object.values(facilities).reduce((sum, n) => sum + n, 0);
      return { date, total, facilities };
    });

    const facilityTotals: Record<string, number> = {};
    for (const r of recentReservations) {
      const fid = r.facilityId || "unknown";
      facilityTotals[fid] = (facilityTotals[fid] || 0) + 1;
    }
    const facilityIds = Object.entries(facilityTotals)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);

    // ── 2. ユーザー登録推移（過去30日の累計） ──
    const userGrowth: { date: string; total: number; newUsers: number }[] = [];
    const usersByDate: Record<string, number> = {};
    usersSnap.docs.forEach((doc) => {
      const d = doc.data();
      if (d.createdAt) {
        const dateStr = dayjs(d.createdAt).format("YYYY-MM-DD");
        usersByDate[dateStr] = (usersByDate[dateStr] || 0) + 1;
      }
    });

    // 30日前時点の累計ユーザー数を計算
    let cumulativeBeforeRange = 0;
    usersSnap.docs.forEach((doc) => {
      const d = doc.data();
      if (d.createdAt && dayjs(d.createdAt).format("YYYY-MM-DD") < thirtyDaysAgo) {
        cumulativeBeforeRange++;
      }
    });

    let cumulative = cumulativeBeforeRange;
    for (let i = 29; i >= 0; i--) {
      const d = today.subtract(i, "day").format("YYYY-MM-DD");
      const newCount = usersByDate[d] || 0;
      cumulative += newCount;
      userGrowth.push({ date: d, total: cumulative, newUsers: newCount });
    }

    // ── 3. 時間帯別予約分布 ──
    const hourlyDistribution: { hour: string; count: number }[] = [];
    const hourlyCounts: Record<number, number> = {};
    for (const r of allReservations) {
      if (r.startTime) {
        const hour = parseInt(r.startTime.split(":")[0], 10);
        if (!isNaN(hour)) {
          hourlyCounts[hour] = (hourlyCounts[hour] || 0) + 1;
        }
      }
    }
    // 営業時間 8:00-22:00
    for (let h = 8; h <= 21; h++) {
      hourlyDistribution.push({
        hour: `${h}:00`,
        count: hourlyCounts[h] || 0,
      });
    }

    // ── 4. クエスト・イベントのグッド数ランキング ──
    const questRanking = questsSnap.docs
      .map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          title: (d.title as string) || "無題",
          goodCount: (d.goodCount as number) || 0,
          type: "quest" as const,
        };
      })
      .filter((q) => q.goodCount > 0)
      .sort((a, b) => b.goodCount - a.goodCount)
      .slice(0, 5);

    const eventRanking = eventsSnap.docs
      .map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          title: (d.title as string) || "無題",
          goodCount: (d.goodCount as number) || 0,
          type: "event" as const,
        };
      })
      .filter((e) => e.goodCount > 0)
      .sort((a, b) => b.goodCount - a.goodCount)
      .slice(0, 5);

    // ── 5. 施設別利用率（全期間） ──
    const facilityUsage = facilityIds.map((fid) => ({
      name: facilityNames[fid] || fid,
      count: facilityTotals[fid] || 0,
    }));

    // ── 6. コンテンツ統計 ──
    const publishedQuests = questsSnap.docs.filter((d) => d.data().published).length;
    const publishedEvents = eventsSnap.docs.filter((d) => d.data().published).length;

    return NextResponse.json({
      // 基本KPI
      totalUsers,
      activeUsers,
      totalReservations,
      upcomingReservations,
      todayReservations,
      reservationsThisMonth,
      // グラフデータ
      dailyData,
      facilityIds,
      facilityNames,
      userGrowth,
      hourlyDistribution,
      questRanking,
      eventRanking,
      facilityUsage,
      // コンテンツ統計
      totalQuests: questsSnap.size,
      publishedQuests,
      totalEvents: eventsSnap.size,
      publishedEvents,
    });
  } catch (error) {
    console.error("[admin/stats] GET error:", error);
    return NextResponse.json({ error: "統計取得に失敗しました" }, { status: 500 });
  }
}
