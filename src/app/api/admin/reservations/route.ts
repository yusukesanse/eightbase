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

    // ユーザー情報を取得するため users（LINE）+ authorizedUsers の両方を参照
    const userMap: Record<string, { displayName: string; tenantName: string; email: string; pictureUrl: string }> = {};

    // 1) LINE ユーザー（users コレクション）を先に読む
    const lineUsersSnap = await db.collection("users").get();
    lineUsersSnap.docs.forEach((d) => {
      const data = d.data();
      const uid = data.lineUserId ?? d.id;
      userMap[uid] = {
        displayName: data.displayName ?? "",
        tenantName: data.tenantName ?? "",
        email: data.email ?? "",
        pictureUrl: data.pictureUrl ?? "",
      };
    });

    // 2) authorizedUsers で上書き（lineUserId が紐付いている場合のみ）
    const authUsersSnap = await db.collection("authorizedUsers").get();
    authUsersSnap.docs.forEach((d) => {
      const data = d.data();
      if (data.lineUserId) {
        userMap[data.lineUserId] = {
          displayName: data.displayName ?? userMap[data.lineUserId]?.displayName ?? "",
          tenantName: data.tenantName ?? userMap[data.lineUserId]?.tenantName ?? "",
          email: data.email ?? "",
          pictureUrl: userMap[data.lineUserId]?.pictureUrl ?? "",
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
          displayName: userInfo?.displayName || d.displayName || d.lineUserId,
          tenantName: userInfo?.tenantName || "",
          email: userInfo?.email || "",
          pictureUrl: userInfo?.pictureUrl || "",
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
