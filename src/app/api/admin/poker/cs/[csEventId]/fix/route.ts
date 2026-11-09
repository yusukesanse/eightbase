import type { NextRequest } from "next/server";
import { POKER_CS_RULES } from "@/lib/gameCsRules";
import { handleAdminCsFix } from "@/lib/gameCs/fix";

type Ctx = { params: Promise<{ csEventId: string }> };

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/poker/cs/[csEventId]/fix — 障害時の管理者手修正
 * body:
 *  { action: "resetBracket" } … 編成を保持して closed へ戻す（rounds空・championId/podium 削除）
 *  { action: "editMatch", matchId, results: [{ lineUserId, points, tiebreakPoints?: number[] }] }
 *      … 指定卓のチップを管理者が上書き確定。通過の境目が同点なら追加ハンドの結果も必要（400）。
 */
export const POST = (req: NextRequest, ctx: Ctx) => handleAdminCsFix(req, ctx, POKER_CS_RULES);
