import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { validateTableReports, deriveRanksFromPoints } from "@/lib/mahjong";
import { writeAuditLog } from "@/lib/auditLog";
import type { MahjongTable, MahjongTableMember } from "@/types";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/mahjong/tables/[tableId]
 * 申告内容の修正（管理者）
 * body: { members: { lineUserId: string; points: number; rank: number }[] }
 *
 * 修正後も合計100,000点・順位整合性の検証を行い、
 * 通過すれば completed、しなければ reporting に戻す。
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ tableId: string }> }
) {
  const admin = await checkAdminAuth(req);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => null);

    // action="confirm": 入力済みの持ち点から**着順を振り直して**確定させる。
    // 麻雀の着順は持ち点で決まるので、入力者が行順で着順を付け間違えた卓を救済できる。
    // 検証（合計100,000点・順位1〜4）は通常どおり行い、通らなければ reporting のまま理由を返す。
    // body.force=true（2026-09-07 追加）: 合計が 100,000 点でなくても**管理者権限で確定**する。
    //   紙の記録が飛んでいる・端数の書き間違い等で合計が合わない卓を、順位表に載せられるようにするため。
    //   4名全員の持ち点が入っていることは必須（未入力の卓は force でも確定しない）。
    //   reviewReason に「合計不一致のまま確定」を残し、監査ログ table.adminForceConfirmed を書く。
    if (body?.action === "confirm") {
      const force = body?.force === true;
      const { tableId } = await params;
      const ref = getDb().collection("mahjongTables").doc(tableId);
      const doc = await ref.get();
      if (!doc.exists) {
        return NextResponse.json({ error: "卓が見つかりません" }, { status: 404 });
      }
      const table = doc.data() as MahjongTable;
      const members = deriveRanksFromPoints(table.members);
      const validation = validateTableReports(members);
      const forced = !validation.ok && force && validation.allReported &&
        members.length === 4 && members.every((m) => Number.isSafeInteger(m.points)) &&
        Number.isSafeInteger(validation.total) && validation.total !== 100000;
      const status = validation.ok || forced ? "completed" : "reporting";

      await ref.update({
        members,
        status,
        updatedAt: new Date().toISOString(),
        ...(forced
          ? { needsReview: false, reviewReason: `管理者が合計不一致（${(validation.total ?? 0).toLocaleString()}点）のまま確定` }
          : {}),
      });
      if (forced) {
        await writeAuditLog({
          eventType: "table.adminForceConfirmed",
          gameCategory: "mahjong",
          actor: admin,
          target: { date: table.eventDate, tableId },
          afterStatus: "completed",
          meta: { total: validation.total, reason: validation.error },
        });
      }
      return NextResponse.json({ success: status === "completed", tableStatus: status, forced, validation });
    }

    const tableLabel: unknown = body?.tableLabel;
    if (tableLabel !== undefined && (typeof tableLabel !== "string" || !/^[A-D]?$/.test(tableLabel))) {
      return NextResponse.json({ error: "卓ラベルは A〜D で指定してください" }, { status: 400 });
    }
    const updates: unknown = body?.members;
    const labelOnly = updates === undefined && tableLabel !== undefined;
    if (!labelOnly && (!Array.isArray(updates) || updates.length === 0)) {
      return NextResponse.json({ error: "members が不正です" }, { status: 400 });
    }
    for (const u of (Array.isArray(updates) ? updates : [])) {
      if (
        typeof u?.lineUserId !== "string" ||
        typeof u?.points !== "number" ||
        !Number.isInteger(u.points) ||
        typeof u?.rank !== "number" ||
        ![1, 2, 3, 4].includes(u.rank)
      ) {
        return NextResponse.json(
          { error: "points は整数、rank は1〜4で指定してください" },
          { status: 400 }
        );
      }
    }

    const { tableId } = await params;
    const ref = getDb().collection("mahjongTables").doc(tableId);
    const doc = await ref.get();
    if (!doc.exists) {
      return NextResponse.json({ error: "卓が見つかりません" }, { status: 404 });
    }

    const table = doc.data() as MahjongTable;
    if (labelOnly) {
      await ref.update({ tableLabel, updatedAt: new Date().toISOString() });
      return NextResponse.json({ success: true, tableStatus: table.status });
    }
    const updateMap = new Map(
      (updates as { lineUserId: string; points: number; rank: number }[]).map(
        (u) => [u.lineUserId, u]
      )
    );

    const members: MahjongTableMember[] = table.members.map((m) => {
      const u = updateMap.get(m.lineUserId);
      return u
        ? {
            ...m,
            points: u.points,
            rank: u.rank,
            reportedAt: m.reportedAt ?? new Date().toISOString(),
          }
        : m;
    });

    const validation = validateTableReports(members);
    const status = validation.ok ? "completed" : "reporting";

    await ref.update({
      members,
      status,
      ...(tableLabel !== undefined ? { tableLabel } : {}),
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, tableStatus: status, validation });
  } catch (error) {
    console.error("[admin/mahjong/tables/:id] PATCH error:", error);
    return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/mahjong/tables/[tableId]
 * 卓の削除（管理者は集計済みでも削除可）
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ tableId: string }> }
) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { tableId } = await params;
    const ref = getDb().collection("mahjongTables").doc(tableId);
    const doc = await ref.get();
    if (!doc.exists) {
      return NextResponse.json({ error: "卓が見つかりません" }, { status: 404 });
    }

    await ref.delete();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/mahjong/tables/:id] DELETE error:", error);
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }
}
