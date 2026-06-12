import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { getSessionUserId } from "@/lib/session";
import type { MahjongTable } from "@/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/mahjong/tables/[tableId]
 * 卓の詳細（メンバーのみ閲覧可）
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tableId: string }> }
) {
  try {
    const userId = await getSessionUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const { tableId } = await params;
    const doc = await getDb().collection("mahjongTables").doc(tableId).get();
    if (!doc.exists) {
      return NextResponse.json({ error: "卓が見つかりません" }, { status: 404 });
    }

    const table = { ...(doc.data() as MahjongTable), tableId: doc.id };
    if (!table.memberIds.includes(userId)) {
      return NextResponse.json({ error: "この卓のメンバーではありません" }, { status: 403 });
    }

    return NextResponse.json({ table });
  } catch (error) {
    console.error("[mahjong/tables/:id] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

/**
 * DELETE /api/mahjong/tables/[tableId]
 * 卓の削除（代表者のみ・集計確定前のみ）
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ tableId: string }> }
) {
  try {
    const userId = await getSessionUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const { tableId } = await params;
    const ref = getDb().collection("mahjongTables").doc(tableId);
    const doc = await ref.get();
    if (!doc.exists) {
      return NextResponse.json({ error: "卓が見つかりません" }, { status: 404 });
    }

    const table = doc.data() as MahjongTable;
    if (table.createdBy !== userId) {
      return NextResponse.json({ error: "代表者のみ削除できます" }, { status: 403 });
    }
    if (table.status === "completed") {
      return NextResponse.json(
        { error: "集計済みの卓は削除できません（管理者に連絡してください）" },
        { status: 400 }
      );
    }

    await ref.delete();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[mahjong/tables/:id] DELETE error:", error);
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }
}
