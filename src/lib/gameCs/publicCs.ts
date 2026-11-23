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
import { cutsFor, evaluateScoreMatch, legacyPoints } from "@/lib/gameCsMatch";
import { legacyWinRank } from "@/lib/gameCsWinnerMatch";
import type { GameCsRules } from "@/lib/gameCsRules";
import type { MahjongCsEvent } from "@/types";

export type PublicCs = ReturnType<typeof toPublicCs>;

/** CSイベントを公開DTOに整形（lineUserId を除去し isMe/seed を付与）。 */
export function toPublicCs(event: MahjongCsEvent & { demoDummy?: boolean }, userId: string, rules: GameCsRules) {
  const manual = isManualCs(event);
  // 勝った人を申告する種目（ビリヤード）。他種目の応答にはキーを足さない
  const winner = rules.report === "winner";
  const entries = event.entries ?? [];
  const mine = entries.find((e) => e.lineUserId === userId);
  const legacyEntered = event.entrants.some((e) => e.lineUserId === userId);
  const myEntry = manual
    ? (mine ? { state: mine.state, waitlistPosition: waitlistPosition(entries, userId) } : null)
    : (legacyEntered ? { state: "confirmed" as const, waitlistPosition: null } : null);
  const seedIds = new Set(event.entrants.filter((e) => e.seed).map((e) => e.lineUserId));
  const player = (
    p: { lineUserId: string; displayName: string; pictureUrl?: string; points?: number | null; rank?: number | null },
    claims?: Record<string, string>,
  ) => {
    // 旧形式のビリヤードは結果が won にある（rank はリーグのシード順位）。表示だけ着順に直す
    const legacyRank = winner && !manual ? legacyWinRank(p) : undefined;
    return {
      displayName: p.displayName,
      pictureUrl: p.pictureUrl ?? "",
      // 旧形式はポーカーが chips、ダーツが score に値を持つ（管理画面と同じ補い方）
      points: p.points ?? legacyPoints(p) ?? null,
      rank: legacyRank !== undefined ? legacyRank : p.rank ?? null,
      seed: seedIds.has(p.lineUserId),
      isMe: p.lineUserId === userId,
      // 勝者申告: 申告済みかだけ返す（誰を勝者にしたかは返さない）
      ...(winner && manual ? { claimed: claims?.[p.lineUserId] != null } : {}),
    };
  };
  const nameOf = (id: string | null) => {
    const e = id ? event.entrants.find((x) => x.lineUserId === id) : null;
    return e ? { displayName: e.displayName, pictureUrl: e.pictureUrl ?? "" } : null;
  };
  // 旧形式のビリヤードは表彰を championId・runnerUpId・thirdId に持つ
  const legacy = event as { runnerUpId?: string | null; thirdId?: string | null };
  const podium = event.podium ?? (winner && !manual && event.championId
    ? { gold: event.championId, silver: legacy.runnerUpId ?? null, bronze: legacy.thirdId ?? null } : null);
  // 旧形式のビリヤードは3位決定戦を決勝ラウンドの2卓目に入れている。そのままだと画面が「勝者が優勝」と出すので、
  // 表示だけ決勝の前の独立ラウンド（third）に分ける（新形式と同じ並び）。
  const rounds = winner && !manual
    ? event.rounds.flatMap((r) => {
      const third = r.type === "final" ? r.matches.filter((m) => m.label === "3位決定戦") : [];
      return third.length === 0 ? [r] : [
        { ...r, type: "third" as const, label: "3位決定戦", matches: third },
        { ...r, matches: r.matches.filter((m) => m.label !== "3位決定戦") },
      ];
    })
    : event.rounds;
  // 敗者が3位決定戦へ進む卓（place:2 の札の出どころ）。ビリヤードだけ
  const loserSources = new Set(winner && manual ? event.rounds.flatMap((r) => r.matches.flatMap((m) => (m.seats ?? [])
    .flatMap((seat) => (seat?.kind === "ticket" && seat.place === 2 ? [seat.fromMatchId] : [])))) : []);
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
    podium: podium ? {
      gold: nameOf(podium.gold), silver: nameOf(podium.silver), bronze: nameOf(podium.bronze),
    } : null,
    entrants: event.entrants.map((e) => ({ displayName: e.displayName, pictureUrl: e.pictureUrl ?? "", tier: e.tier, rank: e.rank, seed: e.seed, isMe: e.lineUserId === userId })),
    rounds: rounds.map((r) => ({
      type: r.type,
      label: r.label,
      advanceCount: r.advanceCount,
      matches: r.matches.map((m) => {
        // 麻雀では tiebreak にならないので tiebreakMine は常に false・tiebreakSubmitted は出ない（evaluate は純関数・読み取りなし）
        const tb = m.status === "tiebreak"
          ? evaluateScoreMatch(m.players, cutsFor(r.type === "final", m.advanceCount ?? r.advanceCount)) : null;
        const level = tb?.tiebreakLevel[userId];
        const tiebreakMine = !!level;
        return {
          matchId: m.matchId, label: m.label, status: m.status, players: m.players.map((p) => player(p, m.claims)),
          ...(typeof m.advanceCount === "number" ? { advanceCount: m.advanceCount } : {}),
          pendingSeats: (m.seats ?? []).flatMap((seat) =>
            seat?.kind === "ticket" && typeof seat.fromMatchId === "string" && !seat.lineUserId
              ? [ticketLabel(event.rounds, seat.fromMatchId, seat.place, winner)] : []),
          tiebreakMine,
          // 勝者申告: 自分の申告を me / opponent で返す（相手の lineUserId は出さない）。卓にいない人・未申告は null
          ...(winner && manual ? {
            loserAdvances: loserSources.has(m.matchId),
            myClaim: m.claims?.[userId] == null ? null : m.claims[userId] === userId ? "me" as const : "opponent" as const,
          } : {}),
          // 対象者だけ: 今の回の追加勝負の値を送ったか（送った後も相手がそろうまで tiebreak のまま＝画面で「相手待ち」を出す）
          ...(tiebreakMine ? {
            tiebreakSubmitted: m.players.find((p) => p.lineUserId === userId)?.tiebreakPoints?.[level! - 1] != null,
          } : {}),
        };
      }),
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
