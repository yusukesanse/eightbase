/**
 * CS（利用者向け・閲覧）の公開DTOと GET の本体。種目の違いは GameCsRules で受ける。
 * 公開DTO: 内部 lineUserId は返さず、代わりに isMe / seed を付与する。
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { getActiveSeason } from "@/lib/mahjong";
import { ensureCsClosed } from "@/lib/mahjongCsServer";
import { isManualCs, waitlistPosition } from "@/lib/mahjongCsEntry";
import { ticketLabel } from "@/lib/mahjongCsBracket";
import { cutsFor, evaluateScoreMatch } from "@/lib/gameCsMatch";
import type { GameCsRules } from "@/lib/gameCsRules";
import type { MahjongCsEvent } from "@/types";

export type PublicCs = ReturnType<typeof toPublicCs>;

/** CSイベントを公開DTOに整形（lineUserId を除去し isMe/seed を付与）。 */
export function toPublicCs(event: MahjongCsEvent & { demoDummy?: boolean }, userId: string, _rules: GameCsRules) {
  const manual = isManualCs(event);
  const entries = event.entries ?? [];
  const mine = entries.find((e) => e.lineUserId === userId);
  const legacyEntered = event.entrants.some((e) => e.lineUserId === userId);
  const myEntry = manual
    ? (mine ? { state: mine.state, waitlistPosition: waitlistPosition(entries, userId) } : null)
    : (legacyEntered ? { state: "confirmed" as const, waitlistPosition: null } : null);
  const seedIds = new Set(event.entrants.filter((e) => e.seed).map((e) => e.lineUserId));
  const player = (p: { lineUserId: string; displayName: string; pictureUrl?: string; points?: number | null; rank?: number | null }) => ({
    displayName: p.displayName,
    pictureUrl: p.pictureUrl ?? "",
    points: p.points ?? null,
    rank: p.rank ?? null,
    seed: seedIds.has(p.lineUserId),
    isMe: p.lineUserId === userId,
  });
  const nameOf = (id: string | null) => {
    const e = id ? event.entrants.find((x) => x.lineUserId === id) : null;
    return e ? { displayName: e.displayName, pictureUrl: e.pictureUrl ?? "" } : null;
  };
  const champEntrant = event.championId ? event.entrants.find((e) => e.lineUserId === event.championId) : null;
  return {
    csEventId: event.csEventId,
    seasonId: event.seasonId,
    name: event.name,
    eventDate: event.eventDate,
    status: event.status,
    capacity: manual ? event.capacity! : null,
    entryOpensAt: manual ? event.entryOpensAt ?? null : null,
    entryClosesAt: manual ? event.entryClosesAt ?? null : null,
    confirmedCount: manual ? entries.filter((e) => e.state === "confirmed").length : event.entrants.length,
    waitlistCount: manual ? entries.filter((e) => e.state === "waitlisted").length : 0,
    myEntry,
    demoDummy: event.demoDummy ?? false,
    champion: champEntrant ? { displayName: champEntrant.displayName, pictureUrl: champEntrant.pictureUrl ?? "" } : null,
    // 麻雀は podium を書かないので常に null
    podium: event.podium ? {
      gold: nameOf(event.podium.gold), silver: nameOf(event.podium.silver), bronze: nameOf(event.podium.bronze),
    } : null,
    entrants: event.entrants.map((e) => ({ displayName: e.displayName, pictureUrl: e.pictureUrl ?? "", tier: e.tier, rank: e.rank, seed: e.seed, isMe: e.lineUserId === userId })),
    rounds: event.rounds.map((r) => ({
      type: r.type,
      label: r.label,
      advanceCount: r.advanceCount,
      matches: r.matches.map((m) => ({
        matchId: m.matchId, label: m.label, status: m.status, players: m.players.map(player),
        ...(typeof m.advanceCount === "number" ? { advanceCount: m.advanceCount } : {}),
        pendingSeats: (m.seats ?? []).flatMap((seat) =>
          seat?.kind === "ticket" && typeof seat.fromMatchId === "string" && !seat.lineUserId
            ? [ticketLabel(event.rounds, seat.fromMatchId, seat.place)] : []),
        // 麻雀では tiebreak にならないので常に false（evaluate は純関数・読み取りなし）
        tiebreakMine: m.status === "tiebreak"
          && evaluateScoreMatch(m.players, cutsFor(r.type === "final", m.advanceCount ?? r.advanceCount)).tiebreakIds.includes(userId),
      })),
    })),
  };
}

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

/** GET /api/{game}/cs — アクティブシーズンの最新CS（利用者向け・閲覧）。旧形式は自動で始めない。 */
export async function handleCsGet(
  req: NextRequest,
  rules: GameCsRules,
  getUserId: (req: NextRequest) => Promise<string | null>
): Promise<NextResponse> {
  try {
    // 認証とアクティブシーズン取得は独立＝並列化。
    const [userId, season] = await Promise.all([getUserId(req), getActiveSeason(rules.game)]);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }
    if (!season) return NextResponse.json({ event: null, entered: false }, NO_STORE);

    const snap = await getDb()
      .collection(rules.collection)
      .where("seasonId", "==", season.seasonId)
      .get();

    const events = snap.docs
      .map((d) => ({ ...(d.data() as MahjongCsEvent & { demoDummy?: boolean }), csEventId: d.id }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    // 受付締切を過ぎた新方式の CS は参加者を確定してから公開整形
    const raw = events[0] ? await ensureCsClosed(events[0], rules.collection) : null;
    const event = raw ? toPublicCs(raw, userId, rules) : null;
    return NextResponse.json({ event, entered: event?.myEntry != null }, NO_STORE);
  } catch (error) {
    console.error(`[${rules.game}/cs] GET error:`, error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
