import type { NextRequest } from "next/server";
import { MAHJONG_CS_RULES } from "@/lib/gameCsRules";
import { handleAdminCsDelete, handleAdminCsGet, handleAdminCsPatch } from "@/lib/gameCs/admin";

type Ctx = { params: Promise<{ csEventId: string }> };

export const dynamic = "force-dynamic";

/** GET /api/admin/mahjong/cs/[csEventId] — CSイベント詳細 */
export const GET = (req: NextRequest, ctx: Ctx) => handleAdminCsGet(req, ctx, MAHJONG_CS_RULES);

/** PATCH /api/admin/mahjong/cs/[csEventId] — 受付・編成を action ごとに更新する。 */
export const PATCH = (req: NextRequest, ctx: Ctx) => handleAdminCsPatch(req, ctx, MAHJONG_CS_RULES);

/** DELETE /api/admin/mahjong/cs/[csEventId] — CS削除 */
export const DELETE = (req: NextRequest, ctx: Ctx) => handleAdminCsDelete(req, ctx, MAHJONG_CS_RULES);
