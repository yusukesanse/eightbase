import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import dayjs from "dayjs";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN;

function checkAdminAuth(req: NextRequest): boolean {
  if (!ADMIN_TOKEN) return false;
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${ADMIN_TOKEN}`;
}

/**
 * GET /api/admin/stats
 * 管理者向け統計情報を返す。
 */
export async function GET(req: NextRequest) {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    const today = dayjs().format("YYYY-MM-DD");
    const monthStart = dayjs().startOf("month").format("YYYY-MM-DD");

    const [usersSnap, reservationsSnap] = await Promise.all([
      db.collection("authorizedUsers").get(),
      db.collection("reservations").where("status", "==", "confirmed").get(),
    ]);

    const totalUsers = usersSnap.size;
    const activeUsers = usersSnap.docs.filter((d) => d.data().active).length;

    const allReservations = reservationsSnap.docs.map((d) => d.data());
    const totalReservations = allReservations.length;
    const upcomingReservations = allReservations.filter((r) => r.date >= today).length;
    const todayReservations = allReservations.filter((r) => r.date === today).length;
    const reservationsThisMonth = allReservations.filter((r) => r.date >= monthStart).length;

    return NextResponse.json({
      totalUsers,
      activeUsers,
      totalReservations,
      upcomingReservations,
      todayReservations,
      reservationsThisMonth,
    });
  } catch (error) {
    console.error("[admin/stats] GET error:", error);
    return NextResponse.json({ error: "統計取得に失敗しました" }, { status: 500 });
  }
}
