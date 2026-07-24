import { NextRequest, NextResponse } from "next/server";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { getPokerDayState, fetchPokerParticipants } from "@/lib/pokerDay";
import { isValidPokerDate } from "@/lib/pokerEntryValidation";
import { POKER_MIN_PARTICIPANTS, POKER_GAME_DURATION_MIN, POKER_INITIAL_CHIPS, type PokerDayMember } from "@/types/poker";

export const dynamic = "force-dynamic";

/**
 * GET /api/poker/day?eventDate=YYYY-MM-DD — 当日スナップショット。
 * ディーラー主導の複数試合。phase と現在の試合、ロスター、各プレイヤーの申告状況を返す。
 * 内部 lineUserId は「現在の試合のディーラー」にのみ渡す（代理申告に必要）。
 */
export async function GET(req: NextRequest) {
  const userId = await requireGameUser(req);
  if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const season = await getActiveSeason("poker");
  if (!season) return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });

  const eventDate = req.nextUrl.searchParams.get("eventDate");
  if (!isValidPokerDate(eventDate)) {
    return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
  }

  try {
    const day = await getPokerDayState(season.seasonId, eventDate);

    // ロスター（＝ディーラー候補）: 受付後は確定参加者、受付前は現在の支払い済み。
    const roster: PokerDayMember[] =
      day?.entryClosedAt ? day.participants : await fetchPokerParticipants(season.seasonId, eventDate);

    const game = day && day.games.length > 0 ? day.games[day.games.length - 1] : null;
    let phase: "dealerSelect" | "ready" | "playing" | "reporting" | "finished";
    if (day?.finishedAt) phase = "finished";
    else if (!game || game.status === "confirmed") phase = "dealerSelect";
    else phase = game.status;

    const iAmParticipant = roster.some((p) => p.lineUserId === userId);
    const iAmDealer = !!game && game.dealerId === userId && game.status !== "confirmed";
    const dealerName = game ? roster.find((p) => p.lineUserId === game.dealerId)?.displayName ?? "ディーラー" : null;

    // 現在の試合のプレイヤー（＝参加者からディーラーを除く）。ディーラーには lineUserId と申告値も渡す。
    let currentGame: unknown = null;
    if (game && game.status !== "confirmed") {
      const playerIds = day!.participants.map((p) => p.lineUserId).filter((id) => id !== game.dealerId);
      const players = playerIds.map((id) => {
        const m = roster.find((p) => p.lineUserId === id);
        const reported = game.reports[id] !== undefined;
        return {
          ...(iAmDealer ? { lineUserId: id } : {}),
          displayName: m?.displayName ?? "ユーザー",
          isMe: id === userId,
          reported,
          ...(iAmDealer ? { chips: game.reports[id]?.chips ?? null } : {}),
        };
      });
      currentGame = {
        gameIndex: game.gameIndex,
        status: game.status,
        dealerName,
        iAmDealer,
        iAmPlayer: playerIds.includes(userId),
        startedAt: game.startedAt ?? null,
        durationMin: POKER_GAME_DURATION_MIN,
        players,
        reportedCount: playerIds.filter((id) => game.reports[id] !== undefined).length,
        total: playerIds.length,
        myReported: game.reports[userId] !== undefined,
        myChips: game.reports[userId]?.chips ?? null,
        maxChips: POKER_INITIAL_CHIPS * playerIds.length,
      };
    }

    return NextResponse.json(
      {
        started: !!day?.entryClosedAt,
        finished: !!day?.finishedAt,
        phase,
        eventDate,
        minParticipants: POKER_MIN_PARTICIPANTS,
        paidCount: roster.length,
        iAmParticipant,
        participants: roster.map((p) => ({ displayName: p.displayName, pictureUrl: p.pictureUrl ?? "", isMe: p.lineUserId === userId })),
        gamesPlayed: day ? day.games.filter((g) => g.status === "confirmed").length : 0,
        currentGame,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[poker/day] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
