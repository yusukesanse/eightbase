import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireActiveUser } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { isPreviewMode } from "@/lib/preview";
import { dummyTables } from "@/lib/previewDummy";
import type { MahjongTable, MahjongTableMember } from "@/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/mahjong/tables
 * 卓一覧（アクティブシーズン）
 * クエリ:
 *   mine=1   - 自分がメンバーの卓のみ
 *   status   - reporting | completed
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireActiveUser(req);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    // プレビューモード: ダミーの卓を返す（本番には出ない）
    if (await isPreviewMode(req)) {
      return NextResponse.json(dummyTables);
    }

    const season = await getActiveSeason();
    if (!season) {
      return NextResponse.json({ tables: [], seasonId: null });
    }

    const db = getDb();
    // 複合インデックス不要: seasonId のみで where し、残りは JS 側でフィルタ
    const snap = await db
      .collection("mahjongTables")
      .where("seasonId", "==", season.seasonId)
      .get();

    const mine = req.nextUrl.searchParams.get("mine") === "1";
    const status = req.nextUrl.searchParams.get("status");

    let tables = snap.docs.map((d) => ({ ...(d.data() as MahjongTable), tableId: d.id }));
    if (mine) tables = tables.filter((t) => t.memberIds.includes(userId));
    if (status) tables = tables.filter((t) => t.status === status);

    tables.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return NextResponse.json({ tables, seasonId: season.seasonId });
  } catch (error) {
    console.error("[mahjong/tables] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

/**
 * POST /api/mahjong/tables
 * 卓を作成（代表者）
 * body: { memberIds: string[4] }  ※作成者自身を含む4人
 */
export async function POST() {
  // 卓作成は管理者のみ（利用者向けUIでは「運営が自動で組みます」と案内）
  return NextResponse.json({ error: "卓の作成は管理者のみ可能です" }, { status: 403 });

  /* 以下は管理者API（/api/admin/mahjong/matching）で実装済み
    const body = await req.json().catch(() => null);
    const memberIds: unknown = body?.memberIds;

    if (
      !Array.isArray(memberIds) ||
      memberIds.length !== 4 ||
      memberIds.some((id) => typeof id !== "string" || !id) ||
      new Set(memberIds).size !== 4
    ) {
      return NextResponse.json(
        { error: "メンバーは重複なしの4人を指定してください" },
        { status: 400 }
      );
    }
    if (!memberIds.includes(userId)) {
      return NextResponse.json(
        { error: "代表者自身がメンバーに含まれている必要があります" },
        { status: 400 }
      );
    }

    const season = await getActiveSeason();
    if (!season) {
      return NextResponse.json(
        { error: "アクティブなシーズンがありません" },
        { status: 400 }
      );
    }

    const db = getDb();

    // メンバーのユーザー情報を取得
    const userDocs = await Promise.all(
      (memberIds as string[]).map((id) => db.collection("users").doc(id).get())
    );
    const missing = userDocs.filter((d) => !d.exists);
    if (missing.length > 0) {
      return NextResponse.json(
        { error: "存在しないユーザーが含まれています" },
        { status: 400 }
      );
    }

    const members: MahjongTableMember[] = userDocs.map((d) => {
      const u = d.data() || {};
      return {
        lineUserId: d.id,
        displayName: u.displayName || "ユーザー",
        pictureUrl: u.pictureUrl || "",
        points: null,
        rank: null,
        reportedAt: null,
      };
    });

    const now = new Date();
    // JST の日付（YYYY-MM-DD）
    const eventDate = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Tokyo",
    }).format(now);

    const table: Omit<MahjongTable, "tableId"> = {
      seasonId: season.seasonId,
      eventDate,
      createdBy: userId,
      memberIds: memberIds as string[],
      members,
      status: "reporting",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    const ref = await db.collection("mahjongTables").add(table);

    return NextResponse.json({ table: { ...table, tableId: ref.id } }, { status: 201 });
  } catch (error) {
    console.error("[mahjong/tables] POST error:", error);
    return NextResponse.json({ error: "卓の作成に失敗しました" }, { status: 500 });
  }
  */
}
