import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getDb } from "@/lib/firebaseAdmin";
import type { AccessRequest } from "@/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/access-requests
 * 利用申請の一覧（全件・新しい順）。pending を先頭に並べ替えて返す。
 * （where+orderBy の複合インデックスを避けるため単純クエリで取得しアプリ側で整列）
 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const db = getDb();
    const snap = await db.collection("accessRequests").orderBy("createdAt", "desc").limit(200).get();
    const requests: AccessRequest[] = snap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        lineUserId: x.lineUserId ?? "",
        lineDisplayName: x.lineDisplayName ?? "",
        displayName: x.displayName ?? "",
        email: x.email ?? "",
        companyName: x.companyName ?? "",
        requestedRole: x.requestedRole === "guest" ? "guest" : "member",
        status: x.status ?? "pending",
        createdAt: x.createdAt ?? "",
        reviewedAt: x.reviewedAt,
        reviewedBy: x.reviewedBy,
        invitationId: x.invitationId,
      };
    });
    // 承認待ちを先頭へ（同status内は新しい順のまま）
    requests.sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1));
    return NextResponse.json({ requests });
  } catch (e) {
    console.error("[admin/access-requests] GET error:", e instanceof Error ? e.message : "error");
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
