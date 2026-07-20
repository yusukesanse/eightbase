import { NextRequest, NextResponse } from "next/server";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason, isGameMaster } from "@/lib/mahjong";
import {
  getDartsDayState,
  fetchDartsParticipants,
  computeDartsEventResults,
} from "@/lib/dartsDay";
import { isValidDartsDate } from "@/lib/dartsEntryValidation";
import type { DartsDayMember, DartsEventState } from "@/types/darts";

export const dynamic = "force-dynamic";

/**
 * GET /api/darts/day?eventDate=YYYY-MM-DD — 当日スナップショット。
 * GM には内部 lineUserId 込みの全情報（編成・代理申告に必要）、参加者には公開 DTO（他人の lineUserId は伏せる）。
 * 未開始なら started:false（GM のみ現在の支払い済みロスターを返す）。
 */
export async function GET(req: NextRequest) {
  const userId = await requireGameUser(req);
  if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const season = await getActiveSeason("darts");
  if (!season) return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });

  const eventDate = req.nextUrl.searchParams.get("eventDate");
  if (!isValidDartsDate(eventDate)) {
    return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
  }

  const isGm = isGameMaster(season, userId);

  try {
    const day = await getDartsDayState(season.seasonId, eventDate);

    // 未開始: GM は現在の支払い済みロスターを、参加者は最小情報のみ。
    if (!day) {
      const roster = isGm ? await fetchDartsParticipants(season.seasonId, eventDate) : [];
      return NextResponse.json(
        {
          started: false,
          finished: false,
          isGameMaster: isGm,
          participants: isGm
            ? roster.map((p) => ({ lineUserId: p.lineUserId, displayName: p.displayName, pictureUrl: p.pictureUrl ?? "", isMe: p.lineUserId === userId }))
            : [],
          paidCount: roster.length,
          events: null,
          zeroOneVariant: null,
          cricketTeams: [],
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const nameOf = new Map<string, DartsDayMember>(day.participants.map((p) => [p.lineUserId, p]));
    const teamOfUser = (uid: string) => (day.cricketTeams ?? []).find((t) => t.memberIds.includes(uid));

    const participants = day.participants.map((p) => ({
      ...(isGm ? { lineUserId: p.lineUserId } : {}),
      displayName: p.displayName,
      pictureUrl: p.pictureUrl ?? "",
      isMe: p.lineUserId === userId,
    }));

    const events = day.events.map((ev: DartsEventState) => {
      const keyCount =
        ev.kind === "cricket"
          ? (day.cricketTeams ?? []).length
          : day.participants.length;
      const reportedCount = Object.keys(ev.reports).length;
      const myReported =
        ev.kind === "cricket"
          ? (() => {
              const t = teamOfUser(userId);
              return !!t && ev.reports[t.teamId] !== undefined;
            })()
          : ev.reports[userId] !== undefined;

      // 確定後のみ順位/ポイントを公開（進行中は伏せる）。
      let results: unknown[] | null = null;
      if (ev.status === "confirmed") {
        results = computeDartsEventResults(day, ev).map((r) => ({
          ...(isGm ? { lineUserId: r.lineUserId } : {}),
          displayName: nameOf.get(r.lineUserId)?.displayName ?? "ユーザー",
          isMe: r.lineUserId === userId,
          value: r.value,
          rank: r.rank,
          points: r.points,
          ...(r.teamId ? { teamId: r.teamId } : {}),
        }));
      }

      return { kind: ev.kind, status: ev.status, reportedCount, total: keyCount, myReported, results };
    });

    const cricketTeams = (day.cricketTeams ?? []).map((t) => ({
      teamId: t.teamId,
      ...(isGm ? { memberIds: t.memberIds } : {}),
      members: t.memberIds.map((id) => ({
        displayName: nameOf.get(id)?.displayName ?? "ユーザー",
        isMe: id === userId,
      })),
      isMine: t.memberIds.includes(userId),
    }));

    return NextResponse.json(
      {
        started: !!day.entryClosedAt,
        finished: !!day.finishedAt,
        isGameMaster: isGm,
        participants,
        paidCount: day.participants.length,
        events,
        zeroOneVariant: day.zeroOneVariant ?? null,
        cricketTeams,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[darts/day] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
