import { validAdvance } from "./mahjongCsBracket";
import type { MahjongCsCanvasTable, MahjongCsEntrant, MahjongCsEvent, MahjongCsRound, MahjongCsSeat } from "@/types";

export type CanvasDraft = { seedUserIds: string[]; tables: MahjongCsCanvasTable[] };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const leftOrder = (a: MahjongCsCanvasTable, b: MahjongCsCanvasTable): number =>
  a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);


export function incomingCount(tables: MahjongCsCanvasTable[], id: string): number {
  return tables.filter((t) => t.to === id).reduce((sum, t) => sum + (validAdvance(t.advanceCount) ? t.advanceCount : 0), 0);
}

export function openSeats(tables: MahjongCsCanvasTable[], id: string): number {
  return 4 - incomingCount(tables, id) - (tables.find((t) => t.id === id)?.playerIds.length ?? 0);
}

// Zの次はAAとして卓の左右順を表示する
function tableLetter(index: number): string {
  let result = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    result = String.fromCharCode(65 + (n - 1) % 26) + result;
  }
  return result;
}

export function canvasToRounds(tables: MahjongCsCanvasTable[]): { rounds: MahjongCsRound[]; errors: string[] } {
  if (tables.length === 0) return { rounds: [], errors: ["卓がありません"] };
  const errors: string[] = [];
  const byId = new Map(tables.map((t) => [t.id, t]));
  for (const t of tables) {
    if (t.to !== null && (t.to === t.id || !byId.has(t.to))) errors.push(`卓(${t.id}): 矢印の先の卓がありません`);
  }
  let cycle = false;
  for (const t of tables) {
    const seen = new Set<string>();
    let current: MahjongCsCanvasTable | undefined = t;
    while (current) {
      if (seen.has(current.id)) { cycle = true; break; }
      seen.add(current.id);
      current = current.to === null ? undefined : byId.get(current.to);
    }
  }
  if (cycle) errors.push("矢印が輪になっています");
  const finals = tables.filter((t) => t.to === null).length;
  if (finals !== 1) errors.push(`決勝（矢印が出ていない卓）は1つにしてください（今 ${finals} 卓）`);
  if (errors.length > 0) return { rounds: [], errors };

  // グラフが正常なときだけ決勝までの距離で段を決める
  const levels = new Map<number, MahjongCsCanvasTable[]>();
  for (const t of tables) {
    let depth = 0;
    let current = t;
    while (current.to !== null) { current = byId.get(current.to)!; depth++; }
    levels.set(depth, [...(levels.get(depth) ?? []), t]);
  }
  const maxDepth = Math.max(...levels.keys());
  const rounds: MahjongCsRound[] = [...levels.keys()].sort((a, b) => b - a).map((depth) => {
    const label = depth === 0 ? "決勝" : depth === 1 ? "準決勝" : depth === 2 ? "準々決勝"
      : maxDepth === 3 ? "予選" : `予選${maxDepth - depth + 1}回戦`;
    const group = levels.get(depth)!.sort(leftOrder);
    return {
      type: depth === 0 ? "final" : "prelim", label, advanceCount: group[0].advanceCount,
      matches: group.map((t, index) => {
        const matchLabel = `${label}${group.length === 1 ? "" : tableLetter(index)}卓`;
        const seats: MahjongCsSeat[] = [];
        for (const source of tables.filter((s) => s.to === t.id).sort(leftOrder)) {
          if (!validAdvance(source.advanceCount)) continue;
          for (let place = 1; place <= source.advanceCount; place++) {
            seats.push({ kind: "ticket", fromMatchId: source.id, place });
          }
        }
        seats.push(...t.playerIds.map((lineUserId) => ({ kind: "player" as const, lineUserId })));
        if (seats.length > 4) errors.push(`${matchLabel}: 席が足りません（${seats.length}名入ります）`);
        while (seats.length < 4) seats.push(null);
        if (!validAdvance(t.advanceCount)) errors.push(`${matchLabel}: 勝ち抜け人数は1〜3名にしてください`);
        return { matchId: t.id, label: matchLabel, players: [], status: "reporting", seats, advanceCount: t.advanceCount };
      }),
    };
  });
  return { rounds, errors };
}

export function tableLabels(tables: MahjongCsCanvasTable[]): Map<string, string> {
  const { rounds } = canvasToRounds(tables);
  return rounds.length > 0
    ? new Map(rounds.flatMap((round) => round.matches.map((match) => [match.matchId, match.label] as const)))
    : new Map([...tables].sort(leftOrder).map((table, index) => [table.id, `卓${tableLetter(index)}`]));
}

export function unplacedIds(draft: CanvasDraft, entrantIds: string[]): string[] {
  const placed = new Set(draft.tables.flatMap((t) => t.playerIds));
  return entrantIds.filter((id) => !placed.has(id));
}

export function initialCanvasDraft(event: Pick<MahjongCsEvent, "bracket">): CanvasDraft {
  return clone({ seedUserIds: event.bracket?.seedUserIds ?? [], tables: event.bracket?.canvas?.tables ?? [] });
}

export function addTable(d: CanvasDraft, id: string, x: number, y: number, advanceCount: number): CanvasDraft {
  const next = clone(d);
  if (!next.tables.some((t) => t.id === id)) next.tables.push({ id, x, y, advanceCount, to: null, playerIds: [] });
  return next;
}

export function removeTable(d: CanvasDraft, id: string): CanvasDraft {
  const next = clone(d);
  next.tables = next.tables.filter((t) => t.id !== id);
  for (const t of next.tables) if (t.to === id) t.to = null;
  return next;
}

export function moveTable(d: CanvasDraft, id: string, x: number, y: number): CanvasDraft {
  const next = clone(d);
  const table = next.tables.find((t) => t.id === id);
  if (table) { table.x = x; table.y = y; }
  return next;
}

export function connect(d: CanvasDraft, fromId: string, toId: string): CanvasDraft {
  const next = clone(d);
  const byId = new Map(next.tables.map((t) => [t.id, t]));
  const from = byId.get(fromId);
  if (!from || !byId.has(toId) || fromId === toId) return next;
  const seen = new Set([fromId]);
  let current = byId.get(toId);
  while (current) {
    if (seen.has(current.id)) return next;
    seen.add(current.id);
    current = current.to === null ? undefined : byId.get(current.to);
  }
  from.to = toId;
  return next;
}

export function disconnect(d: CanvasDraft, fromId: string): CanvasDraft {
  const next = clone(d);
  const table = next.tables.find((t) => t.id === fromId);
  if (table) table.to = null;
  return next;
}

export function setTableAdvance(d: CanvasDraft, id: string, n: number): CanvasDraft {
  const next = clone(d);
  const table = next.tables.find((t) => t.id === id);
  if (table && validAdvance(n)) table.advanceCount = n;
  return next;
}

export function placePlayer(d: CanvasDraft, lineUserId: string, tableId: string): CanvasDraft {
  const next = clone(d);
  const target = next.tables.find((t) => t.id === tableId);
  if (!target || openSeats(next.tables, tableId) <= 0) return next;
  for (const t of next.tables) t.playerIds = t.playerIds.filter((id) => id !== lineUserId);
  target.playerIds.push(lineUserId);
  return next;
}

export function removePlayer(d: CanvasDraft, lineUserId: string): CanvasDraft {
  const next = clone(d);
  for (const t of next.tables) t.playerIds = t.playerIds.filter((id) => id !== lineUserId);
  return next;
}

export function toggleSeed(d: CanvasDraft, lineUserId: string): CanvasDraft {
  const next = clone(d);
  next.seedUserIds = next.seedUserIds.includes(lineUserId)
    ? next.seedUserIds.filter((id) => id !== lineUserId) : [...next.seedUserIds, lineUserId];
  return next;
}

export function setTierSeeds(d: CanvasDraft, entrants: MahjongCsEntrant[], tier: "M1" | "M2", on: boolean): CanvasDraft {
  const next = clone(d);
  const ids = entrants.filter((e) => e.tier === tier).map((e) => e.lineUserId);
  next.seedUserIds = on ? [...new Set([...next.seedUserIds, ...ids])]
    : next.seedUserIds.filter((id) => !ids.includes(id));
  return next;
}

export function fillEmptySeats(d: CanvasDraft, entrantIds: string[]): CanvasDraft {
  const next = clone(d);
  const waiting = [...new Set(unplacedIds(next, entrantIds).filter((id) => !next.seedUserIds.includes(id)))];
  const targets = next.tables.filter((t) => !next.tables.some((source) => source.to === t.id))
    .sort((a, b) => b.y - a.y || leftOrder(a, b));
  for (const t of targets) t.playerIds.push(...waiting.splice(0, Math.max(0, openSeats(next.tables, t.id))));
  return next;
}
