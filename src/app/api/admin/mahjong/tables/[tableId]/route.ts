import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { validateTableReports } from "@/lib/mahjong";
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
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => null);
    const updates: unknown = body?.members;
    if (!Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json({ error: "members が不正です" }, { status: 400 });
    }
    for (const u of updates) {
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
