import type { MahjongCsEntrant, MahjongCsEvent, MahjongCsRound, MahjongCsSeat } from "@/types";
import { unplacedEntrantIds } from "./mahjongCsBracket";

export type Draft = { seedUserIds: string[]; rounds: MahjongCsRound[] };
export type Chip =
  | { kind: "player"; lineUserId: string }
  | { kind: "ticket"; fromMatchId: string; place: number };

// 入力と参照を共有しない編集用のコピーを作る。
function copy(draft: Draft): Draft {
  return JSON.parse(JSON.stringify(draft));
}
// 勝ち抜け人数の範囲を検証する。
function validAdvance(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 3;
}
// ラウンドの添字を検証する。
function validRound(draft: Draft, index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < draft.rounds.length;
}
// 卓の位置を全ラウンドから探す。
function locate(draft: Draft, id: string) {
  for (const [ri, round] of draft.rounds.entries()) {
    const match = round.matches.find((m) => m.matchId === id);
    if (match) return { ri, match };
  }
  return null;
}
// 席の添字を検証する。
function validSeat(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < 4;
}
// 人または札の同一性を判定する。
function sameChip(seat: MahjongCsSeat, chip: Chip): boolean {
  if (seat?.kind === "player" && chip.kind === "player") return seat.lineUserId === chip.lineUserId;
  return seat?.kind === "ticket" && chip.kind === "ticket"
    && seat.fromMatchId === chip.fromMatchId && seat.place === chip.place;
}
// 卓番号を二十六卓以上にも対応する英字にする。
function letter(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : letter(Math.floor(index / 26) - 1) + letter(index % 26);
}
// 卓の表示名を位置順に付け直す。
function relabel(round: MahjongCsRound) {
  round.matches.forEach((match, index) => {
    match.label = `${round.label}${letter(index)}卓`;
  });
}
// 最後のラウンドだけ決勝の種別にする。
function resetTypes(draft: Draft) {
  draft.rounds.forEach((round, index) => {
    round.type = index === draft.rounds.length - 1 ? "final" : "prelim";
  });
}
// 指定された条件に該当する札を次ラウンドから取り除く。
function clearTickets(
  round: MahjongCsRound | undefined,
  predicate: (chip: Extract<Chip, { kind: "ticket" }>) => boolean,
) {
  round?.matches.forEach((match) => {
    match.seats = match.seats?.map((seat) => seat?.kind === "ticket" && predicate(seat) ? null : seat);
  });
}
// 保存済みの下書きまたは空の予選を読み込む。
export function initialDraft(event: Pick<MahjongCsEvent, "bracket">, defaultAdvance: 1 | 2 | 3): Draft {
  return copy(event.bracket ?? {
    seedUserIds: [],
    rounds: [{ type: "prelim", label: "予選", advanceCount: defaultAdvance, matches: [] }],
  });
}
// 新しいラウンドを末尾に追加する。
export function addRound(draft: Draft, label: string, advanceCount: number): Draft {
  if (!validAdvance(advanceCount)) return draft;
  const next = copy(draft);
  next.rounds.push({ type: "final", label, advanceCount, matches: [] });
  resetTypes(next);
  return next;
}
// ラウンドとその卓を参照する札を削除する。
export function removeRound(draft: Draft, roundIndex: number): Draft {
  if (!validRound(draft, roundIndex)) return draft;
  const next = copy(draft);
  const ids = new Set(next.rounds[roundIndex].matches.map((m) => m.matchId));
  clearTickets(next.rounds[roundIndex + 1], (seat) => ids.has(seat.fromMatchId));
  next.rounds.splice(roundIndex, 1);
  resetTypes(next);
  return next;
}
// ラウンド名と所属する卓名を変更する。
export function renameRound(draft: Draft, roundIndex: number, label: string): Draft {
  if (!validRound(draft, roundIndex)) return draft;
  const next = copy(draft);
  next.rounds[roundIndex].label = label;
  relabel(next.rounds[roundIndex]);
  return next;
}
// 勝ち抜け人数を変更し、不要になった札を取り除く。
export function setAdvanceCount(draft: Draft, roundIndex: number, n: number): Draft {
  if (!validRound(draft, roundIndex) || !validAdvance(n)) return draft;
  const next = copy(draft);
  next.rounds[roundIndex].advanceCount = n;
  clearTickets(next.rounds[roundIndex + 1], (seat) => seat.place > n);
  return next;
}
// 重複しない識別子で四席の卓を追加する。
export function addTable(draft: Draft, roundIndex: number, newId: string): Draft {
  if (!validRound(draft, roundIndex) || !newId || locate(draft, newId)) return draft;
  const next = copy(draft);
  next.rounds[roundIndex].matches.push({
    matchId: newId, label: "", players: [], status: "reporting", seats: [null, null, null, null],
  });
  relabel(next.rounds[roundIndex]);
  return next;
}
// 卓を削除し、残る卓名と次ラウンドの札を更新する。
export function removeTable(draft: Draft, roundIndex: number, matchId: string): Draft {
  if (!validRound(draft, roundIndex) || locate(draft, matchId)?.ri !== roundIndex) return draft;
  const next = copy(draft);
  next.rounds[roundIndex].matches = next.rounds[roundIndex].matches.filter((m) => m.matchId !== matchId);
  relabel(next.rounds[roundIndex]);
  clearTickets(next.rounds[roundIndex + 1], (seat) => seat.fromMatchId === matchId);
  return next;
}
// 同じチップを元の席から外して指定席へ移す。
export function placeChip(draft: Draft, chip: Chip, matchId: string, seatIndex: number): Draft {
  const target = locate(draft, matchId);
  if (!target || !validSeat(seatIndex)) return draft;
  if (chip.kind === "ticket") {
    const source = locate(draft, chip.fromMatchId);
    if (!source || target.ri !== source.ri + 1 || !Number.isInteger(chip.place)
      || chip.place < 1 || chip.place > draft.rounds[source.ri].advanceCount) return draft;
  }
  const next = copy(draft);
  for (const round of next.rounds) {
    for (const match of round.matches) {
      match.seats = (match.seats ?? [null, null, null, null]).map((seat) => sameChip(seat, chip) ? null : seat);
    }
  }
  locate(next, matchId)!.match.seats![seatIndex] = { ...chip };
  return next;
}
// 指定席を空席に戻す。
export function clearSeat(draft: Draft, matchId: string, seatIndex: number): Draft {
  if (!locate(draft, matchId) || !validSeat(seatIndex)) return draft;
  const next = copy(draft);
  const match = locate(next, matchId)!.match;
  match.seats ??= [null, null, null, null];
  match.seats[seatIndex] = null;
  return next;
}
// 直前ラウンドから来る未配置の札を列挙する。
export function availableTickets(draft: Draft, roundIndex: number): Chip[] {
  if (!validRound(draft, roundIndex) || roundIndex === 0) return [];
  const previous = draft.rounds[roundIndex - 1];
  const seats = draft.rounds.flatMap((r) => r.matches.flatMap((m) => m.seats ?? []));
  return previous.matches.flatMap((match) => Array.from({ length: previous.advanceCount }, (_, index): Chip => ({
    kind: "ticket", fromMatchId: match.matchId, place: index + 1,
  }))).filter((chip) => !seats.some((seat) => sameChip(seat, chip)));
}
// 一人のシード指定を切り替える。
export function toggleSeed(draft: Draft, lineUserId: string): Draft {
  const next = copy(draft);
  next.seedUserIds = next.seedUserIds.includes(lineUserId)
    ? next.seedUserIds.filter((id) => id !== lineUserId) : [...next.seedUserIds, lineUserId];
  return next;
}
// 指定リーグの参加者を順序を保ったままシードに追加または除外する。
export function setTierSeeds(draft: Draft, entrants: MahjongCsEntrant[], tier: "M1" | "M2", on: boolean): Draft {
  const ids = entrants.filter((entrant) => entrant.tier === tier).map((entrant) => entrant.lineUserId);
  const next = copy(draft);
  next.seedUserIds = on ? [...new Set([...next.seedUserIds, ...ids])]
    : next.seedUserIds.filter((id) => !ids.includes(id));
  return next;
}
// 未配置の非シード参加者を予選の空席へ順に入れる。
export function fillEmptySeats(draft: Draft, entrantIds: string[]): Draft {
  const next = copy(draft);
  const ids = [...new Set(unplacedEntrantIds(draft.rounds, entrantIds))]
    .filter((id) => !draft.seedUserIds.includes(id));
  for (const match of next.rounds[0]?.matches ?? []) {
    match.seats ??= [null, null, null, null];
    match.seats = match.seats.map((seat) => {
      if (seat || ids.length === 0) return seat;
      return { kind: "player", lineUserId: ids.shift()! };
    });
  }
  return next;
}
