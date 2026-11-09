import type { NextRequest } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { MAHJONG_CS_RULES } from "@/lib/gameCsRules";
import { handleCsGet } from "@/lib/gameCs/publicCs";

export const dynamic = "force-dynamic";

/** GET /api/mahjong/cs — アクティブシーズンの最新CS（利用者向け・閲覧） */
export const GET = (req: NextRequest) => handleCsGet(req, MAHJONG_CS_RULES, getSessionUserId);
