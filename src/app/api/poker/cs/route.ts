import type { NextRequest } from "next/server";
import { requireGameUser } from "@/lib/auth";
import { POKER_CS_RULES } from "@/lib/gameCsRules";
import { handleCsGet } from "@/lib/gameCs/publicCs";

export const dynamic = "force-dynamic";

/** GET /api/poker/cs — アクティブシーズンの最新CS（利用者向け・閲覧）。旧形式は自動で始めない */
export const GET = (req: NextRequest) => handleCsGet(req, POKER_CS_RULES, requireGameUser);
