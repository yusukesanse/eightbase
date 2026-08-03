import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getActiveSeason, validateTableReports } from "@/lib/mahjong";
import { writeAuditLog } from "@/lib/auditLog";
import type { MahjongTable, MahjongTableMember } from "@/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/mahjong/tables?seasonId=xxx
 * 卓一覧（管理者）。seasonId 未指定ならアクティブシーズン
 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let seasonId = req.nextUrl.searchParams.get("seasonId");
    if (!seasonId) {
      const season = await getActiveSeason();
      if (!season) {
        return NextResponse.json({ tables: [], seasonId: null });
      }
      seasonId = season.seasonId;
    }

    const snap = await getDb()
      .collection("mahjongTables")
      .where("seasonId", "==", seasonId)
      .get();

    const tables = snap.docs
      .map((d) => ({ ...(d.data() as MahjongTable), tableId: d.id }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return NextResponse.json({ tables, seasonId });
  } catch (error) {
    console.error("[admin/mahjong/tables] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

/** 1卓の人数。麻雀はちょうど4名（余りは抜け番）。 */
const TABLE_SIZE = 4;

/**
 * POST /api/admin/mahjong/tables
 * body: { seasonId, eventDate, members: { lineUserId, points, rank }[] }（ちょうど4名）
 *
 * 管理者が**卓を新規作成**する（アプリを通さず紙で付けた結果を後から入れるため）。
 * 2026-08-01 はゲストが参加できない不具合のためアプリに点数を入れられず紙運用になった。
 * 既存の PATCH（申告の修正）と DELETE はあったが、そもそも卓が無い日は何も入れられなかった。
 *
 * 参加者は**アプリ利用者なら誰でも指定できる**（参加表明の有無を問わない）。
 * 当日その場で入った人・名簿に載れなかったゲストを救えるようにするため。
 *
 * 検証は利用者申告と同じ `validateTableReports`（合計100,000点・順位1〜4が1人ずつ）。
 * 通らない場合も **reporting として保存**する（PATCH と同じ挙動）。
 * reporting は集計対象外なので通算順位は汚れない。UI で「集計対象外」と明示すること。
 */
export async function POST(req: NextRequest) {
  const admin = await checkAdminAuth(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json().catch(() => null);
    const seasonId: unknown = body?.seasonId;
    const eventDate: unknown = body?.eventDate;
    const input: unknown = body?.members;

    if (typeof seasonId !== "string" || !seasonId) {
      return NextResponse.json({ error: "seasonId は必須です" }, { status: 400 });
    }
    if (typeof eventDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
      return NextResponse.json({ error: "eventDate は YYYY-MM-DD で指定してください" }, { status: 400 });
    }
    if (!Array.isArray(input) || input.length !== TABLE_SIZE) {
      return NextResponse.json({ error: `メンバーはちょうど${TABLE_SIZE}名で指定してください` }, { status: 400 });
    }
    for (const m of input) {
      if (
        typeof m?.lineUserId !== "string" || !m.lineUserId ||
        typeof m?.points !== "number" || !Number.isInteger(m.points) ||
        m.points < -200000 || m.points > 200000 ||
        typeof m?.rank !== "number" || ![1, 2, 3, 4].includes(m.rank)
      ) {
        return NextResponse.json(
          { error: "points は整数（±200,000以内）、rank は1〜4で指定してください" },
          { status: 400 }
        );
      }
    }
    const entries = input as { lineUserId: string; points: number; rank: number }[];
    if (new Set(entries.map((m) => m.lineUserId)).size !== entries.length) {
      return NextResponse.json({ error: "同じ人を複数回選ぶことはできません" }, { status: 400 });
    }

    const db = getDb();
    const seasonDoc = await db.collection("seasons").doc(seasonId).get();
    if (!seasonDoc.exists) {
      return NextResponse.json({ error: "シーズンが見つかりません" }, { status: 404 });
    }
    if ((seasonDoc.data()?.gameCategory ?? "mahjong") !== "mahjong") {
      return NextResponse.json({ error: "麻雀のシーズンではありません" }, { status: 400 });
    }

    // 表示名・アイコンはサーバーで解決する（クライアントの申告値を信用しない）。
    // 身分の正は authorizedUsers、アイコンは users(docId=lineUserId)。
    const ids = entries.map((m) => m.lineUserId);
    const authSnap = await db.collection("authorizedUsers").where("active", "==", true).get();
    const nameById = new Map<string, string>();
    for (const doc of authSnap.docs) {
      const d = doc.data();
      const id = typeof d.lineUserId === "string" ? d.lineUserId : "";
      if (!id || nameById.has(id)) continue;
      nameById.set(id, typeof d.displayName === "string" ? d.displayName : "");
    }
    const unknownIds = ids.filter((id) => !nameById.has(id));
    if (unknownIds.length > 0) {
      return NextResponse.json(
        { error: "利用者として登録されていない人が含まれています（無効化された方は選べません）" },
        { status: 400 }
      );
    }
    const userDocs = await db.getAll(...ids.map((id) => db.collection("users").doc(id)));
    const pictureById = new Map<string, string>();
    for (const doc of userDocs) {
      if (doc.exists) pictureById.set(doc.id, (doc.data()?.pictureUrl as string) || "");
    }

    const nowIso = new Date().toISOString();
    const members: MahjongTableMember[] = entries.map((m) => ({
      lineUserId: m.lineUserId,
      displayName: nameById.get(m.lineUserId) || "",
      pictureUrl: pictureById.get(m.lineUserId) || "",
      points: m.points,
      rank: m.rank,
      reportedAt: nowIso,
    }));

    const validation = validateTableReports(members);
    const status = validation.ok ? "completed" : "reporting";

    const ref = db.collection("mahjongTables").doc();
    const table: MahjongTable = {
      tableId: ref.id,
      seasonId,
      eventDate,
      // 管理者が入れたことを残す（GM/自動生成と区別できるようにする）。
      createdBy: `admin:${admin}`,
      memberIds: ids,
      members,
      status,
      // 管理者が意図して入れた値なので自己申告の異常検知フラグは立てない。
      needsReview: false,
      reviewReason: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await ref.set(table);

    await writeAuditLog({
      eventType: "table.adminCreated",
      gameCategory: "mahjong",
      actor: admin,
      target: { tableId: ref.id, date: eventDate },
      afterStatus: status,
      meta: { memberIds: ids, points: entries.map((m) => m.points) },
    });

    return NextResponse.json({ success: true, tableId: ref.id, tableStatus: status, validation });
  } catch (error) {
    console.error("[admin/mahjong/tables] POST error:", error);
    return NextResponse.json({ error: "卓の作成に失敗しました" }, { status: 500 });
  }
}
