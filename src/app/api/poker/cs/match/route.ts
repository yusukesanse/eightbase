import type { NextRequest } from "next/server";
import { POKER_CS_RULES } from "@/lib/gameCsRules";
import { handleScoreMatchReport } from "@/lib/gameCs/scoreMatch";

export const dynamic = "force-dynamic";

/** PATCH /api/poker/cs/match — CS結果（終了時チップ・追加ハンド）の自己申告 */
export const PATCH = (req: NextRequest) => handleScoreMatchReport(req, POKER_CS_RULES);
