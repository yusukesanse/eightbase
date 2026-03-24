import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/reservations
 * 全ユーザーの予約一覧を返す。
 * Query params: ?status=confirmed|cancelled|all (default: confirmed)
 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") ?? "confirmed";

    let query: FirebaseFirestore.Query = db.collection("reservations");
    if (status !== "all") {
      query = query.where("status", "==", status);
    }

    const snap = await query.get();

    // ユーザー情報を取得するため authorizedUsers も参照
    const usersSnap = await db.collection("authorizedUsers").get();
    const userMap: Record<string, { displayName: string; tenantName: string; email: string }> = {};
    usersSnap.docs.forEach((d) => {
      const data = d.data();
      if (data.lineUserId) {
        userMap[data.lineUserId] = {
          displayName: data.displayName,
          tenantName: data.tenantName ?? "",
          email: data.email,
        };
      }
    });

    const reservations = snap.docs
      .map((doc) => {
        const d = doc.data();
        const userInfo = userMap[d.lineUserId] ?? null;
        return {
          reservationId: doc.id,
          facilityId: d.facilityId,
          facilityName: d.facilityName,
          lineUserId: d.lineUserId,
          displayName: userInfo?.displayName ?? d.displayName ?? d.lineUserId,
          tenantName: userInfo?.tenantName ?? "",
          email: userInfo?.email ?? "",
          date: d.date,
          startTime: d.startTime,
          endTime: d.endTime,
          status: d.status,
          googleEventId: d.googleEventId ?? null,
          createdAt: d.createdAt,
        };
      })
      .sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return b.startTime.localeCompare(a.startTime);
      });

    return NextResponse.json({ reservations });
  } catch (error) {
    console.error("[admin/reservations] GET error:", error);
    return NextResponse.json({ error: "予約一覧の取得に失敗しました" }, { status: 500 });
  }
}
