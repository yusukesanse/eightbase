/**
 * 麻雀CS（新方式）の編成と勝ち上がりの純関数。Firestore にも点数計算にも依存しない
 * （将来ほかの種目へ広げるときに使い回せるように）。
 * 札 { kind:"ticket", fromMatchId, place } = 「直前のラウンドの卓 fromMatchId の place 位」が入る席。
 */
import type { MahjongCsEntrant, MahjongCsMatch, MahjongCsMatchPlayer, MahjongCsRound, MahjongCsSeat } from "@/types";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

function isPlayerSeat(seat: unknown): seat is Extract<MahjongCsSeat, { kind: "player" }> {
  return typeof seat === "object" && seat !== null && "kind" in seat && seat.kind === "player"
    && "lineUserId" in seat && typeof seat.lineUserId === "string";
}

function isTicketSeat(seat: unknown): seat is Extract<MahjongCsSeat, { kind: "ticket" }> {
  return typeof seat === "object" && seat !== null && "kind" in seat && seat.kind === "ticket"
    && "fromMatchId" in seat && typeof seat.fromMatchId === "string"
    && "place" in seat && typeof seat.place === "number";
}

function findMatch(rounds: MahjongCsRound[], matchId: string): { ri: number; match: MahjongCsMatch } | null {
  for (let ri = 0; ri < rounds.length; ri++) {
    const match = rounds[ri].matches.find((m) => m.matchId === matchId);
    if (match) return { ri, match };
  }
  return null;
}

export function ticketLabel(rounds: MahjongCsRound[], fromMatchId: string, place: number): string {
  const label = findMatch(rounds, fromMatchId)?.match.label ?? "?";
  return `${label} ${place}位`;
}

function playerIds(rounds: MahjongCsRound[]): string[] {
  return rounds.flatMap((r) => r.matches.flatMap((m) => (m.seats ?? [])
    .flatMap((s) => (isPlayerSeat(s) ? [s.lineUserId] : []))));
}

export function unplacedEntrantIds(rounds: MahjongCsRound[], entrantIds: string[]): string[] {
  const placed = new Set(playerIds(rounds));
  return entrantIds.filter((id) => !placed.has(id));
}

export function validateBracket(rounds: MahjongCsRound[], entrantIds: string[]): string[] {
  const errs: string[] = [];
  if (rounds.length === 0) return ["ラウンドがありません"];
  const entrantSet = new Set(entrantIds);
  const matchIds = new Set<string>();

  rounds.forEach((r, ri) => {
    if (!Number.isInteger(r.advanceCount) || r.advanceCount < 1 || r.advanceCount > 3) {
      errs.push(`${r.label}: 勝ち抜け人数は1〜3名にしてください`);
    }
    if (r.matches.length === 0) errs.push(`${r.label}: 卓がありません`);
    for (const m of r.matches) {
      if (matchIds.has(m.matchId)) errs.push(`${m.label}: 卓IDが重複しています`);
      matchIds.add(m.matchId);
      const seats = m.seats ?? [];
      if (seats.length !== 4 || seats.some((s) => !isPlayerSeat(s) && !isTicketSeat(s))) errs.push(`${m.label}: 空いている席があります`);
      if (ri === 0 && seats.some((s) => isTicketSeat(s))) {
        errs.push(`${m.label}: 最初のラウンドに勝ち抜けの札は置けません`);
      }
    }
  });
  if (rounds[rounds.length - 1].matches.length !== 1) errs.push("最後のラウンドの卓は1つにしてください");

  const seen = new Set<string>();
  for (const id of playerIds(rounds)) {
    if (seen.has(id)) errs.push(`同じ人が2回以上入っています（${id}）`);
    seen.add(id);
    if (!entrantSet.has(id)) errs.push(`参加確定者ではない人が入っています（${id}）`);
  }
  const unplaced = unplacedEntrantIds(rounds, entrantIds);
  if (unplaced.length > 0) errs.push(`まだ席がない参加者が${unplaced.length}名います`);

  // 札: 直前のラウンドの通過枠をちょうど1回ずつ使う
  for (let ri = 1; ri < rounds.length; ri++) {
    const prev = rounds[ri - 1];
    const prevIds = new Set(prev.matches.map((m) => m.matchId));
    const used = new Map<string, number>();
    for (const m of rounds[ri].matches) for (const s of m.seats ?? []) {
      if (!isTicketSeat(s)) continue;
      if (!prevIds.has(s.fromMatchId)) {
        errs.push(`${m.label}: 札は直前のラウンドの卓から置いてください`);
        continue;
      }
      if (!Number.isInteger(s.place) || s.place < 1 || s.place > prev.advanceCount) {
        errs.push(`${m.label}: ${ticketLabel(rounds, s.fromMatchId, s.place)}は勝ち抜け人数を超えています`);
        continue;
      }
      const key = `${s.fromMatchId}#${s.place}`;
      used.set(key, (used.get(key) ?? 0) + 1);
    }
    for (const pm of prev.matches) for (let p = 1; p <= prev.advanceCount; p++) {
      const n = used.get(`${pm.matchId}#${p}`) ?? 0;
      const label = ticketLabel(rounds, pm.matchId, p);
      if (n === 0) errs.push(`${label}の行き先の席がありません`);
      if (n > 1) errs.push(`${label}の札が2回以上置かれています`);
    }
  }
  return errs;
}

function toPlayer(id: string, byId: Map<string, MahjongCsEntrant>): MahjongCsMatchPlayer {
  const e = byId.get(id);
  return {
    lineUserId: id,
    displayName: e?.displayName ?? "ユーザー",
    ...(e?.pictureUrl ? { pictureUrl: e.pictureUrl } : {}),
    points: null,
    rank: null,
  };
}

export function buildRunningRounds(rounds: MahjongCsRound[], entrants: MahjongCsEntrant[]): MahjongCsRound[] {
  const byId = new Map(entrants.map((e) => [e.lineUserId, e]));
  return clone(rounds).map((r, ri) => ({
    ...r,
    type: ri === rounds.length - 1 ? "final" : "prelim",
    matches: r.matches.map((m) => ({
      ...m,
      status: "reporting" as const,
      seats: m.seats?.map((s) => {
        if (isTicketSeat(s)) {
          delete s.lineUserId;
        }
        return s;
      }),
      players: (m.seats ?? []).flatMap((s) => (isPlayerSeat(s) ? [toPlayer(s.lineUserId, byId)] : [])),
    })),
  }));
}

export function applyCompletedMatch(
  rounds: MahjongCsRound[], matchId: string, entrants: MahjongCsEntrant[],
): { rounds: MahjongCsRound[]; finished: boolean; championId?: string } {
  const next = clone(rounds);
  const found = findMatch(next, matchId);
  if (!found) throw new Error("MATCH_NOT_FOUND");
  const { ri, match } = found;
  if (match.status !== "completed") throw new Error("MATCH_NOT_COMPLETED");

  if (ri === next.length - 1) {
    const champ = match.players.find((p) => p.rank === 1);
    return { rounds: next, finished: true, ...(champ ? { championId: champ.lineUserId } : {}) };
  }

  const byId = new Map(entrants.map((e) => [e.lineUserId, e]));
  const ranked = [...match.players].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const targets = next[ri + 1].matches.filter((target) =>
    (target.seats ?? []).some((s) => isTicketSeat(s) && s.fromMatchId === matchId));
  if (targets.some((target) => target.players.some((p) => p.points != null))) {
    throw new Error("DOWNSTREAM_REPORTED");
  }
  for (const target of targets) {
    for (const s of target.seats ?? []) {
      if (!isTicketSeat(s) || s.fromMatchId !== matchId) continue;
      s.lineUserId = ranked[s.place - 1]?.lineUserId;
    }
  }
  for (const target of targets) {
    target.players = (target.seats ?? []).flatMap((s) =>
      (isPlayerSeat(s) || isTicketSeat(s)) && typeof s.lineUserId === "string"
        ? [toPlayer(s.lineUserId, byId)] : []);
  }
  return { rounds: next, finished: false };
}
