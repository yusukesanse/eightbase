import type { NextRequest } from "next/server";
import { requireGameUser } from "@/lib/auth";
import { BILLIARDS_CS_RULES } from "@/lib/gameCsRules";
import { handleCsGet } from "@/lib/gameCs/publicCs";

export const dynamic = "force-dynamic";

/** GET /api/billiards/cs — アクティブシーズンの最新CS（利用者向け・閲覧）。旧形式は自動で始めない */
export const GET = (req: NextRequest) => handleCsGet(req, BILLIARDS_CS_RULES, requireGameUser);
