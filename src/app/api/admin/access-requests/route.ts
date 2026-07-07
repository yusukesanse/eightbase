import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getDb } from "@/lib/firebaseAdmin";
import type { AccessRequest } from "@/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/access-requests?status=pending
 * 利用申請の一覧。既定は pending（承認待ち）。status=all で全件。
 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const status = req.nextUrl.searchParams.get("status") ?? "pending";
    const db = getDb();
    let query = db.collection("accessRequests").orderBy("createdAt", "desc").limit(200);
    if (status !== "all") {
      query = db
        .collection("accessRequests")
        .where("status", "==", status)
        .orderBy("createdAt", "desc")
        .limit(200);
    }
    const snap = await query.get();
    const requests: AccessRequest[] = snap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        lineUserId: x.lineUserId ?? "",
        lineDisplayName: x.lineDisplayName ?? "",
        displayName: x.displayName ?? "",
        email: x.email ?? "",
        companyName: x.companyName ?? "",
        status: x.status ?? "pending",
        createdAt: x.createdAt ?? "",
        reviewedAt: x.reviewedAt,
        reviewedBy: x.reviewedBy,
        invitationId: x.invitationId,
      };
    });
    return NextResponse.json({ requests });
  } catch (e) {
    console.error("[admin/access-requests] GET error:", e instanceof Error ? e.message : "error");
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
