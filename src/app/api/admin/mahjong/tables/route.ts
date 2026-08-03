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
/** 1回の登録で作れる卓数の上限（打ち間違いで大量作成しないための歯止め）。 */
const MAX_TABLES_PER_REQUEST = 30;

type SeatInput = { lineUserId: string; points: number; rank: number };

/** 1卓分の入力が形として妥当か。中身（合計点・順位の重複）は validateTableReports が見る。 */
function invalidSeat(m: unknown): boolean {
  const s = m as SeatInput | undefined;
  return (
    typeof s?.lineUserId !== "string" || !s.lineUserId ||
    typeof s?.points !== "number" || !Number.isInteger(s.points) ||
    s.points < -200000 || s.points > 200000 ||
    typeof s?.rank !== "number" || ![1, 2, 3, 4].includes(s.rank)
  );
}

/**
 * POST /api/admin/mahjong/tables
 * body: { seasonId, eventDate, tables: { members: { lineUserId, points, rank }[] }[] }
 *
 * 管理者が**その日の対戦結果をまとめて作成**する（アプリを通さず紙で付けた結果の後入力）。
 * 2026-08-01 はゲストが参加できない不具合でアプリに点数を入れられず紙運用になった。
 * 既存の PATCH（申告の修正）と DELETE はあったが、そもそも卓が無い日は何も入れられなかった。
 *
 * 1日の入力は「参加者を選ぶ → 実施した卓数を決める → 卓ごとに点数」という流れなので、
 * **複数卓を1リクエストで受ける**（1卓ずつ投げると途中で失敗したとき半端に残る）。
 *
 * 参加者は**アプリ利用者なら誰でも指定できる**（参加表明の有無を問わない）。
 * 当日その場で入った人・名簿に載れなかったゲストを救えるようにするため。
 *
 * 検証は利用者申告と同じ `validateTableReports`（合計100,000点・順位1〜4が1人ずつ）。
 * 通らない卓も **reporting として保存**する（PATCH と同じ挙動）。
 * reporting は集計対象外なので通算順位は汚れない。UI で「集計対象外」と明示すること。
 */
export async function POST(req: NextRequest) {
  const admin = await checkAdminAuth(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json().catch(() => null);
    const seasonId: unknown = body?.seasonId;
    const eventDate: unknown = body?.eventDate;
    const input: unknown = body?.tables;

    if (typeof seasonId !== "string" || !seasonId) {
      return NextResponse.json({ error: "seasonId は必須です" }, { status: 400 });
    }
    if (typeof eventDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
      return NextResponse.json({ error: "eventDate は YYYY-MM-DD で指定してください" }, { status: 400 });
    }
    if (!Array.isArray(input) || input.length === 0) {
      return NextResponse.json({ error: "卓を1つ以上指定してください" }, { status: 400 });
    }
    if (input.length > MAX_TABLES_PER_REQUEST) {
      return NextResponse.json(
        { error: `一度に作成できるのは${MAX_TABLES_PER_REQUEST}卓までです` },
        { status: 400 }
      );
    }

    const tablesInput: SeatInput[][] = [];
    for (const [i, t] of input.entries()) {
      const members: unknown = (t as { members?: unknown })?.members;
      if (!Array.isArray(members) || members.length !== TABLE_SIZE) {
        return NextResponse.json(
          { error: `${i + 1}卓目: メンバーはちょうど${TABLE_SIZE}名で指定してください` },
          { status: 400 }
        );
      }
      if (members.some(invalidSeat)) {
        return NextResponse.json(
          { error: `${i + 1}卓目: points は整数（±200,000以内）、rank は1〜4で指定してください` },
          { status: 400 }
        );
      }
      const seats = members as SeatInput[];
      if (new Set(seats.map((m) => m.lineUserId)).size !== seats.length) {
        return NextResponse.json(
          { error: `${i + 1}卓目: 同じ人を複数の席に選ぶことはできません` },
          { status: 400 }
        );
      }
      tablesInput.push(seats);
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
    const allIds = Array.from(new Set(tablesInput.flat().map((m) => m.lineUserId)));
    const authSnap = await db.collection("authorizedUsers").where("active", "==", true).get();
    const nameById = new Map<string, string>();
    for (const doc of authSnap.docs) {
      const d = doc.data();
      const id = typeof d.lineUserId === "string" ? d.lineUserId : "";
      if (!id || nameById.has(id)) continue;
      nameById.set(id, typeof d.displayName === "string" ? d.displayName : "");
    }
    if (allIds.some((id) => !nameById.has(id))) {
      return NextResponse.json(
        { error: "利用者として登録されていない人が含まれています（無効化された方は選べません）" },
        { status: 400 }
      );
    }
    const userDocs = await db.getAll(...allIds.map((id) => db.collection("users").doc(id)));
    const pictureById = new Map<string, string>();
    for (const doc of userDocs) {
      if (doc.exists) pictureById.set(doc.id, (doc.data()?.pictureUrl as string) || "");
    }

    // 既にその日に卓があるなら続きの半荘番号にする（第n半荘の重複表示を避ける）。
    const sameDay = await db
      .collection("mahjongTables")
      .where("seasonId", "==", seasonId)
      .where("eventDate", "==", eventDate)
      .get();
    const maxRound = sameDay.docs.reduce((max, d) => {
      const r = (d.data() as MahjongTable).round;
      return typeof r === "number" && r > max ? r : max;
    }, 0);

    const nowIso = new Date().toISOString();
    const batch = db.batch();
    const created: { tableId: string; round: number; status: string; error?: string }[] = [];

    tablesInput.forEach((seats, i) => {
      const members: MahjongTableMember[] = seats.map((m) => ({
        lineUserId: m.lineUserId,
        displayName: nameById.get(m.lineUserId) || "",
        pictureUrl: pictureById.get(m.lineUserId) || "",
        points: m.points,
        rank: m.rank,
        reportedAt: nowIso,
      }));
      const validation = validateTableReports(members);
      const status = validation.ok ? "completed" : "reporting";
      const round = maxRound + i + 1;
      const ref = db.collection("mahjongTables").doc();
      const table: MahjongTable = {
        tableId: ref.id,
        seasonId,
        eventDate,
        // 管理者が入れたことを残す（GM/自動生成と区別できるようにする）。
        createdBy: `admin:${admin}`,
        memberIds: seats.map((m) => m.lineUserId),
        members,
        status,
        round,
        // 管理者が意図して入れた値なので自己申告の異常検知フラグは立てない。
        needsReview: false,
        reviewReason: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      batch.set(ref, table);
      created.push({ tableId: ref.id, round, status, ...(validation.ok ? {} : { error: validation.error }) });
    });

    await batch.commit();

    await writeAuditLog({
      eventType: "table.adminCreated",
      gameCategory: "mahjong",
      actor: admin,
      target: { date: eventDate },
      afterStatus: created.every((c) => c.status === "completed") ? "completed" : "reporting",
      meta: { tableCount: created.length, rounds: created.map((c) => c.round), participantIds: allIds },
    });

    return NextResponse.json({
      success: true,
      created,
      completedCount: created.filter((c) => c.status === "completed").length,
      reportingCount: created.filter((c) => c.status !== "completed").length,
    });
  } catch (error) {
    console.error("[admin/mahjong/tables] POST error:", error);
    return NextResponse.json({ error: "卓の作成に失敗しました" }, { status: 500 });
  }
}
