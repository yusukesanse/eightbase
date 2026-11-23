import type { NextRequest } from "next/server";
import { BILLIARDS_CS_RULES } from "@/lib/gameCsRules";
import { handleAdminCsFix } from "@/lib/gameCs/fix";

type Ctx = { params: Promise<{ csEventId: string }> };

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/billiards/cs/[csEventId]/fix — 障害時の管理者手修正
 * body:
 *  { action: "resetBracket" } … 編成を保持して closed へ戻す（rounds空・championId/podium 削除）
 *  { action: "editMatch", matchId, winnerId }
 *      … 指定卓の勝者を管理者が確定（申告の食い違い・相手待ちの卓も確定できる）。次の卓に申告があれば 409。
 */
export const POST = (req: NextRequest, ctx: Ctx) => handleAdminCsFix(req, ctx, BILLIARDS_CS_RULES);
