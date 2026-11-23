import type { NextRequest } from "next/server";
import { DARTS_CS_RULES } from "@/lib/gameCsRules";
import { handleScoreMatchReport } from "@/lib/gameCs/scoreMatch";

export const dynamic = "force-dynamic";

/** PATCH /api/darts/cs/match — CS結果（カウントアップの点数・追加スロー）の自己申告 */
export const PATCH = (req: NextRequest) => handleScoreMatchReport(req, DARTS_CS_RULES);
