import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";
import { validateTableReports } from "@/lib/mahjong";
import { isProduction } from "@/lib/env";
import type { MahjongTable } from "@/types";

export const dynamic = "force-dynamic";

// デモ検証専用: 当日卓の最大半荘数と、順位→持ち点の標準配分（合計100,000）。
const DEMO_MAX_ROUNDS = 4;
const DEMO_RANK_POINTS: Record<number, number> = { 1: 40000, 2: 30000, 3: 20000, 4: 10000 };

/**
 * POST /api/mahjong/tables/[tableId]/report
 * 自分の最終持ち点と卓内順位を申告する（集計確定前なら再申告可）
 * body: { points: number, rank: 1|2|3|4 }
 *
 * 4人全員の申告が揃った時点で検証（合計100,000点・順位整合性）を行い、
 * 通過したら status を completed にして集計対象にする。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tableId: string }> }
) {
  try {
    const userId = await requireGameUser(req);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const points: unknown = body?.points;
    const rank: unknown = body?.rank;

    if (
      typeof points !== "number" ||
      !Number.isInteger(points) ||
      points % 100 !== 0 ||
      points < -200000 ||
      points > 200000
    ) {
      return NextResponse.json(
        { error: "点数は100点単位の整数で入力してください" },
        { status: 400 }
      );
    }
    if (typeof rank !== "number" || ![1, 2, 3, 4].includes(rank)) {
      return NextResponse.json(
        { error: "順位は1〜4で指定してください" },
        { status: 400 }
      );
    }

    const db = getDb();
    const ref = db.collection("mahjongTables").doc((await params).tableId);

    // トランザクションで同時申告の競合を防ぐ
    const result = await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) {
        return { status: 404 as const, error: "卓が見つかりません" };
      }

      const table = doc.data() as MahjongTable;
      if (!table.memberIds.includes(userId)) {
        return { status: 403 as const, error: "この卓のメンバーではありません" };
      }
      if (table.status === "completed") {
        return {
          status: 400 as const,
          error: "この卓は集計確定済みです（修正は管理者に連絡してください）",
        };
      }

      const nowIso = new Date().toISOString();

      // ── デモ検証専用の自動補完（本番・通常ユーザーには一切適用しない） ──
      // 対象は `demoDummy:true` の当日卓かつ非本番のみ。demoユーザー1人の申告で
      // 他ダミーを標準配分で補完し、半荘を成立（completed）させ、次半荘を自動生成する。
      const isDemoTable =
        !isProduction() && (table as { demoDummy?: boolean }).demoDummy === true;
      if (isDemoTable) {
        const remainingRanks = [1, 2, 3, 4].filter((r) => r !== rank);
        let ri = 0;
        const filled = table.members.map((m) => {
          const r = m.lineUserId === userId ? rank : remainingRanks[ri++];
          return { ...m, points: DEMO_RANK_POINTS[r], rank: r, reportedAt: nowIso };
        });
        tx.update(ref, { members: filled, status: "completed", updatedAt: nowIso });

        // 次の半荘を自動生成（同じ4人・最大4半荘）。以降も同じデモ分岐で成立できる。
        const nextRound = (table.round ?? 1) + 1;
        let nextTableId: string | null = null;
        if (nextRound <= DEMO_MAX_ROUNDS) {
          nextTableId = `demo-tbl-${table.seasonId}-live-r${nextRound}`;
          tx.set(db.collection("mahjongTables").doc(nextTableId), {
            seasonId: table.seasonId,
            eventDate: table.eventDate,
            createdBy: "system",
            memberIds: table.memberIds,
            members: table.members.map((m) => ({
              lineUserId: m.lineUserId,
              displayName: m.displayName,
              pictureUrl: m.pictureUrl ?? "",
              points: null,
              rank: null,
              reportedAt: null,
            })),
            status: "reporting",
            round: nextRound,
            tableLabel: table.tableLabel ?? "A",
            createdAt: nowIso,
            updatedAt: nowIso,
            demoDummy: true,
          });
        }
        return {
          status: 200 as const,
          validation: { ok: true, allReported: true, total: 100000 },
          tableStatus: "completed" as const,
          demo: { nextRound: nextTableId ? nextRound : null },
        };
      }

      const members = table.members.map((m) =>
        m.lineUserId === userId
          ? { ...m, points, rank, reportedAt: nowIso }
          : m
      );

      const validation = validateTableReports(members);
      const status = validation.ok ? "completed" : "reporting";

      tx.update(ref, {
        members,
        status,
        updatedAt: nowIso,
      });

      return { status: 200 as const, validation, tableStatus: status };
    });

    if (result.status !== 200) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      success: true,
      tableStatus: result.tableStatus,
      validation: result.validation,
    });
  } catch (error) {
    console.error("[mahjong/tables/:id/report] POST error:", error);
    return NextResponse.json({ error: "申告に失敗しました" }, { status: 500 });
  }
}
