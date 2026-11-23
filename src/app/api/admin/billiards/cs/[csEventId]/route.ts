import type { NextRequest } from "next/server";
import { BILLIARDS_CS_RULES } from "@/lib/gameCsRules";
import { handleAdminCsDelete, handleAdminCsGet, handleAdminCsPatch } from "@/lib/gameCs/admin";

type Ctx = { params: Promise<{ csEventId: string }> };

export const dynamic = "force-dynamic";

/** GET /api/admin/billiards/cs/[csEventId] — CSイベント詳細 */
export const GET = (req: NextRequest, ctx: Ctx) => handleAdminCsGet(req, ctx, BILLIARDS_CS_RULES);

/** PATCH /api/admin/billiards/cs/[csEventId] — 受付・編成を action ごとに更新する（旧形式は 409）。 */
export const PATCH = (req: NextRequest, ctx: Ctx) => handleAdminCsPatch(req, ctx, BILLIARDS_CS_RULES);

/** DELETE /api/admin/billiards/cs/[csEventId] — CS削除（旧形式も削除できる） */
export const DELETE = (req: NextRequest, ctx: Ctx) => handleAdminCsDelete(req, ctx, BILLIARDS_CS_RULES);
