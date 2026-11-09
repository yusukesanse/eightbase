import type { NextRequest } from "next/server";
import { MAHJONG_CS_RULES } from "@/lib/gameCsRules";
import { handleAdminCsCreate, handleAdminCsList } from "@/lib/gameCs/admin";

export const dynamic = "force-dynamic";

/** GET /api/admin/mahjong/cs?seasonId= — CSイベント一覧（新しい順） */
export const GET = (req: NextRequest) => handleAdminCsList(req, MAHJONG_CS_RULES);

/** POST /api/admin/mahjong/cs — 定員と受付期間を指定して作成する。 */
export const POST = (req: NextRequest) => handleAdminCsCreate(req, MAHJONG_CS_RULES);
