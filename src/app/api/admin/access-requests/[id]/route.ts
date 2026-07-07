import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getDb } from "@/lib/firebaseAdmin";
import { normalizeRole } from "@/lib/roles";
import { createInvitation } from "@/lib/invitations";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/access-requests/[id]
 * Body: { action: "approve" | "reject", role?: "member"|"guest"|"staff" }
 *
 * approve: 申請から招待を作成（OTP発行 + authorizedUser + 会社名プリフィル）→ 申請を approved に。
 * reject : 申請を rejected に（利用者への通知はしない＝静かに）。
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const adminEmail = await checkAdminAuth(req);
  if (!adminEmail) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { action, role: rawRole } = (await req.json().catch(() => ({}))) as {
      action?: string;
      role?: string;
    };
    const db = getDb();
    const ref = db.collection("accessRequests").doc(params.id);
    const doc = await ref.get();
    if (!doc.exists) {
      return NextResponse.json({ error: "申請が見つかりません" }, { status: 404 });
    }
    const data = doc.data()!;
    if (data.status !== "pending") {
      return NextResponse.json({ error: "この申請は既に対応済みです" }, { status: 409 });
    }

    const nowStr = new Date().toISOString();

    if (action === "reject") {
      await ref.update({ status: "rejected", reviewedAt: nowStr, reviewedBy: adminEmail });
      return NextResponse.json({ ok: true, status: "rejected" });
    }

    if (action === "approve") {
      const role = normalizeRole(rawRole);
      const result = await createInvitation({
        displayName: data.displayName ?? "",
        email: data.email ?? "",
        role,
        companyName: data.companyName ?? "",
      });
      if (!result.ok) {
        // 例: 既に同一メールが登録済み(409)。申請は pending のまま管理者判断に残す。
        return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
      }
      await ref.update({
        status: "approved",
        reviewedAt: nowStr,
        reviewedBy: adminEmail,
        invitationId: result.invitationId,
      });
      return NextResponse.json({
        ok: true,
        status: "approved",
        role,
        emailSent: result.emailSent,
        passcode: result.passcode, // メール失敗時のみ（手動共有用）
        guestUrl: result.guestUrl,
      });
    }

    return NextResponse.json({ error: "action が不正です" }, { status: 400 });
  } catch (e) {
    console.error("[admin/access-requests/[id]] error:", e instanceof Error ? e.message : "error");
    return NextResponse.json({ error: "処理に失敗しました" }, { status: 500 });
  }
}
