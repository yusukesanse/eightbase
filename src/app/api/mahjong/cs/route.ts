import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { getSessionUserId } from "@/lib/session";
import { getActiveSeason } from "@/lib/mahjong";
import { ensureCsStarted } from "@/lib/mahjongCsServer";
import type { MahjongCsEvent } from "@/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/mahjong/cs
 * アクティブシーズンの最新CSイベント（利用者向け・閲覧）。
 * 公開DTO: 内部 lineUserId は返さず、代わりに isMe / seed を付与する。
 */

/** CSイベントを公開DTOに整形（lineUserId を除去し isMe/seed を付与）。 */
function toPublicCs(event: MahjongCsEvent & { demoDummy?: boolean }, userId: string) {
  const seedIds = new Set(event.entrants.filter((e) => e.seed).map((e) => e.lineUserId));
  const player = (p: { lineUserId: string; displayName: string; pictureUrl?: string; points?: number | null; rank?: number | null }) => ({
    displayName: p.displayName,
    pictureUrl: p.pictureUrl ?? "",
    points: p.points ?? null,
    rank: p.rank ?? null,
    seed: seedIds.has(p.lineUserId),
    isMe: p.lineUserId === userId,
  });
  const champEntrant = event.championId ? event.entrants.find((e) => e.lineUserId === event.championId) : null;
  return {
    csEventId: event.csEventId,
    seasonId: event.seasonId,
    name: event.name,
    eventDate: event.eventDate,
    status: event.status,
    demoDummy: event.demoDummy ?? false,
    champion: champEntrant ? { displayName: champEntrant.displayName, pictureUrl: champEntrant.pictureUrl ?? "" } : null,
    entrants: event.entrants.map((e) => ({ displayName: e.displayName, pictureUrl: e.pictureUrl ?? "", tier: e.tier, rank: e.rank, seed: e.seed, isMe: e.lineUserId === userId })),
    rounds: event.rounds.map((r) => ({
      type: r.type,
      label: r.label,
      advanceCount: r.advanceCount,
      matches: r.matches.map((m) => ({ matchId: m.matchId, label: m.label, status: m.status, players: m.players.map(player) })),
    })),
  };
}

export async function GET(req: NextRequest) {
  try {
    // 認証とアクティブシーズン取得は独立＝並列化。
    const [userId, season] = await Promise.all([getSessionUserId(req), getActiveSeason()]);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }
    if (!season) return NextResponse.json({ event: null, entered: false });

    const snap = await getDb()
      .collection("mahjongCsEvents")
      .where("seasonId", "==", season.seasonId)
      .get();

    const events = snap.docs
      .map((d) => ({ ...(d.data() as MahjongCsEvent & { demoDummy?: boolean }), csEventId: d.id }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    // 確定日が来た CS は予選を自動生成（遅延起動）してから公開整形
    const raw = events[0] ? await ensureCsStarted(events[0]) : null;
    return NextResponse.json({
      event: raw ? toPublicCs(raw, userId) : null,
      entered: raw ? raw.entrants.some((e) => e.lineUserId === userId) : false,
    });
  } catch (error) {
    console.error("[mahjong/cs] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
