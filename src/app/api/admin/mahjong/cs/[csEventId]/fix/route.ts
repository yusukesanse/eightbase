import type { NextRequest } from "next/server";
import { MAHJONG_CS_RULES } from "@/lib/gameCsRules";
import { handleAdminCsFix } from "@/lib/gameCs/fix";

type Ctx = { params: Promise<{ csEventId: string }> };

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/mahjong/cs/[csEventId]/fix — 障害時の管理者手修正
 * body:
 *  { action: "resetBracket" }
 *      … 新方式は編成を保持してclosedへ戻す（rounds空・championId削除）。
 *        旧方式はsetupへ戻し、確定日到来で予選が再生成される。
 *  { action: "editMatch", matchId, results: [{ lineUserId, points, rank }] }
 *      … 指定試合の結果を管理者が上書き確定。新方式は後続ラウンドを保持して札の席を再充填
 *        （次の卓が申告済みなら409）。旧方式は以降のラウンドを破棄して整合を取り直す。
 */
export const POST = (req: NextRequest, ctx: Ctx) => handleAdminCsFix(req, ctx, MAHJONG_CS_RULES);
