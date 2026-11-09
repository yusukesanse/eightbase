import type { NextRequest } from "next/server";
import { POKER_CS_RULES } from "@/lib/gameCsRules";
import { handleCsEntryDelete, handleCsEntryPost } from "@/lib/gameCs/entry";

export const dynamic = "force-dynamic";

/** 利用者のCS参加表明・取消（ポーカー）。リーグ参加済みの人だけが期間内に表明できる。 */
export const POST = (req: NextRequest) => handleCsEntryPost(req, POKER_CS_RULES);
export const DELETE = (req: NextRequest) => handleCsEntryDelete(req, POKER_CS_RULES);
