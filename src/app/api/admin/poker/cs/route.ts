import type { NextRequest } from "next/server";
import { POKER_CS_RULES } from "@/lib/gameCsRules";
import { handleAdminCsCreate, handleAdminCsList } from "@/lib/gameCs/admin";

export const dynamic = "force-dynamic";

/** GET /api/admin/poker/cs?seasonId= — CSイベント一覧（新しい順）。旧形式（capacity なし）は自動で始めない */
export const GET = (req: NextRequest) => handleAdminCsList(req, POKER_CS_RULES);

/** POST /api/admin/poker/cs — 定員と受付期間を指定して作成する（優先枠＝通算1〜8位）。 */
export const POST = (req: NextRequest) => handleAdminCsCreate(req, POKER_CS_RULES);
