import type { NextRequest } from "next/server";
import { BILLIARDS_CS_RULES } from "@/lib/gameCsRules";
import { handleWinnerMatchReport } from "@/lib/gameCs/winnerMatch";

export const dynamic = "force-dynamic";

/** PATCH /api/billiards/cs/match — CS結果（勝った人）の自己申告。卓の2人の申告が一致したら確定 */
export const PATCH = (req: NextRequest) => handleWinnerMatchReport(req, BILLIARDS_CS_RULES);
