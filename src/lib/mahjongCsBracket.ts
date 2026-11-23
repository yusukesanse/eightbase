/**
 * CS（新方式）の編成と勝ち上がりの純関数。4種目共通（席数はルール表から。省略時は麻雀）。
 * Firestore にも点数計算にも依存しない。
 * 札 { kind:"ticket", fromMatchId, place } = 「直前のラウンドの卓 fromMatchId の place 位」が入る席。
 */
import { MAHJONG_CS_RULES, maxAdvanceFor, type GameCsRules } from "./gameCsRules";
import type { MahjongCsEntrant, MahjongCsEvent, MahjongCsMatch, MahjongCsMatchPlayer, MahjongCsRound, MahjongCsSeat } from "@/types";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
export const validAdvance = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= 3;

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

/** 札の呼び名。winner＝勝者を申告する種目（ビリヤード）は「勝者／敗者」で呼ぶ。 */
export function ticketLabel(rounds: MahjongCsRound[], fromMatchId: string, place: number, winner = false): string {
  const label = findMatch(rounds, fromMatchId)?.match.label ?? "?";
  return winner ? `${label} ${place === 1 ? "勝者" : "敗者"}` : `${label} ${place}位`;
}

function playerIds(rounds: MahjongCsRound[]): string[] {
  return rounds.flatMap((r) => r.matches.flatMap((m) => (m.seats ?? [])
    .flatMap((s) => (isPlayerSeat(s) ? [s.lineUserId] : []))));
}

export function unplacedEntrantIds(rounds: MahjongCsRound[], entrantIds: string[]): string[] {
  const placed = new Set(playerIds(rounds));
  return entrantIds.filter((id) => !placed.has(id));
}

export function validateBracket(rounds: MahjongCsRound[], entrantIds: string[], rules: GameCsRules = MAHJONG_CS_RULES): string[] {
  const errs: string[] = [];
  if (rounds.length === 0) return ["ラウンドがありません"];
  const entrantSet = new Set(entrantIds);
  const matchIds = new Set<string>();

  rounds.forEach((r, ri) => {
    if (r.matches.length === 0) errs.push(`${r.label}: 卓がありません`);
    for (const m of r.matches) {
      const advanceCount = m.advanceCount ?? r.advanceCount;
      if (!validAdvance(advanceCount)) {
        errs.push(`${m.label}: 勝ち抜け人数は1〜3名にしてください`);
      }
      if (matchIds.has(m.matchId)) errs.push(`${m.label}: 卓IDが重複しています`);
      matchIds.add(m.matchId);
      const seats = m.seats ?? [];
      if (seats.length < rules.minSeats || seats.length > rules.maxSeats
        || seats.some((s) => !isPlayerSeat(s) && !isTicketSeat(s))) errs.push(`${m.label}: 空いている席があります`);
      else if (validAdvance(advanceCount)
        && advanceCount > maxAdvanceFor(rules, seats.length, ri === rounds.length - 1)) {
        errs.push(ri === rounds.length - 1
          ? `${m.label}: 勝ち抜け人数は卓の人数以下にしてください`
          : `${m.label}: 勝ち抜け人数は卓の人数より少なくしてください`);
      }
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

  // 札: 直前のラウンドの通過枠をちょうど1回ずつ使う。
  // 敗者の矢印を使う種目（ビリヤード）だけ、3位決定戦のラウンドが決勝の前に挟まるので「前のどれかのラウンド」から置ける。
  // 敗者の札（通過人数の次の順位）は使わなくてもよいが、2回は使えない。3位決定戦の勝者は行き先が無くてよい。
  const loser = rules.loserArrow === true;
  const used = new Map<string, number>();
  const checkUsed = (round: MahjongCsRound) => {
    for (const pm of round.matches) {
      const advanceCount = pm.advanceCount ?? round.advanceCount;
      if (!validAdvance(advanceCount)) continue;
      for (let p = 1; p <= advanceCount + (loser ? 1 : 0); p++) {
        const n = used.get(`${pm.matchId}#${p}`) ?? 0;
        const label = ticketLabel(rounds, pm.matchId, p);
        if (n === 0 && p <= advanceCount && round.type !== "third") errs.push(`${label}の行き先の席がありません`);
        if (n > 1) errs.push(`${label}の札が2回以上置かれています`);
      }
    }
  };
  for (let ri = 1; ri < rounds.length; ri++) {
    const prev = rounds[ri - 1];
    const sources = new Map((loser ? rounds.slice(0, ri) : [prev])
      .flatMap((r) => r.matches.map((m) => [m.matchId, { match: m, round: r }] as const)));
    for (const m of rounds[ri].matches) for (const s of m.seats ?? []) {
      if (!isTicketSeat(s)) continue;
      const source = sources.get(s.fromMatchId);
      if (!source) {
        errs.push(`${m.label}: 札は直前のラウンドの卓から置いてください`);
        continue;
      }
      const advanceCount = source.match.advanceCount ?? source.round.advanceCount;
      if (!validAdvance(advanceCount)) continue;
      if (!Number.isInteger(s.place) || s.place < 1 || s.place > advanceCount + (loser ? 1 : 0)) {
        errs.push(`${m.label}: ${ticketLabel(rounds, s.fromMatchId, s.place)}は勝ち抜け人数を超えています`);
        continue;
      }
      const key = `${s.fromMatchId}#${s.place}`;
      used.set(key, (used.get(key) ?? 0) + 1);
    }
    if (!loser) checkUsed(prev);
  }
  if (loser) for (const round of rounds.slice(0, -1)) checkUsed(round);
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
    type: ri === rounds.length - 1 ? "final" : r.type === "third" ? "third" : "prelim",
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

  // 終了は「決勝が確定」かつ「3位決定戦（あれば）が確定」。優勝は確定した卓ではなく決勝の1位から出す
  // （3位決定戦が最後に確定しても、その勝者を優勝にしない）。3位決定戦が無い種目は今までと同じ。
  if (ri === next.length - 1 || next[ri].type === "third") {
    const final = next[next.length - 1].matches[0];
    const finished = final?.status === "completed"
      && next.every((r) => r.type !== "third" || r.matches.every((m) => m.status === "completed"));
    const champ = final?.players.find((p) => p.rank === 1);
    return { rounds: next, finished, ...(finished && champ ? { championId: champ.lineUserId } : {}) };
  }

  const byId = new Map(entrants.map((e) => [e.lineUserId, e]));
  const ranked = [...match.players].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  // 行き先は後ろのラウンドすべてから探す（敗者の札は3位決定戦へ、勝者の札はその先の決勝へ入る）
  const targets = next.slice(ri + 1).flatMap((r) => r.matches).filter((target) =>
    (target.seats ?? []).some((s) => isTicketSeat(s) && s.fromMatchId === matchId));
  // 勝者を申告する種目は確定まで points が空なので、申告（claims）が1件でもあれば「結果が入っている」とみなす
  if (targets.some((target) => target.players.some((p) => p.points != null)
    || Object.keys(target.claims ?? {}).length > 0)) {
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

export function afterMatchCompleted(
  event: Pick<MahjongCsEvent, "entrants">, rounds: MahjongCsRound[], matchId: string,
): { rounds: MahjongCsRound[]; status: "running" | "finished"; championId?: string } {
  const result = applyCompletedMatch(rounds, matchId, event.entrants ?? []);
  return {
    rounds: result.rounds,
    status: result.finished ? "finished" : "running",
    ...(result.finished && result.championId ? { championId: result.championId } : {}),
  };
}
