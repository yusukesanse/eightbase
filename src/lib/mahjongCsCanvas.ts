/** CS編成キャンバスの純関数（4種目共通。席数はルール表から。省略時は麻雀） */
import { MAHJONG_CS_RULES, type GameCsRules } from "./gameCsRules";
import { validAdvance } from "./mahjongCsBracket";
import type { MahjongCsCanvasTable, MahjongCsEntrant, MahjongCsEvent, MahjongCsRound, MahjongCsSeat } from "@/types";

export function classifyWheel(e: { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; metaKey: boolean }): "zoom-pinch" | "pan" | "zoom-wheel" {
  if (e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY))) return "zoom-wheel";
  return e.ctrlKey || e.metaKey ? "zoom-pinch" : "pan";
}

export type CanvasDraft = { seedUserIds: string[]; tables: MahjongCsCanvasTable[] };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const leftOrder = (a: MahjongCsCanvasTable, b: MahjongCsCanvasTable): number =>
  a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);


/** その卓に矢印で入ってくる人数（勝者の矢印は通過人数ぶん、敗者の矢印は1人ぶん） */
export function incomingCount(tables: MahjongCsCanvasTable[], id: string): number {
  return tables.filter((t) => t.to === id).reduce((sum, t) => sum + (validAdvance(t.advanceCount) ? t.advanceCount : 0), 0)
    + tables.filter((t) => t.loserTo === id).length;
}

/** 3位決定戦の卓: 矢印が出ておらず、敗者の矢印だけが入る卓（敗者の矢印を使う種目＝ビリヤードだけ） */
function thirdPlaceIds(tables: MahjongCsCanvasTable[], rules: GameCsRules): Set<string> {
  if (!rules.loserArrow) return new Set();
  return new Set(tables.filter((t) => t.to === null
    && tables.some((s) => s.loserTo === t.id) && !tables.some((s) => s.to === t.id)).map((t) => t.id));
}

export function openSeats(tables: MahjongCsCanvasTable[], id: string, maxSeats = MAHJONG_CS_RULES.maxSeats): number {
  return maxSeats - incomingCount(tables, id) - (tables.find((t) => t.id === id)?.playerIds.length ?? 0);
}

// Zの次はAAとして卓の左右順を表示する
function tableLetter(index: number): string {
  let result = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    result = String.fromCharCode(65 + (n - 1) % 26) + result;
  }
  return result;
}

export function canvasToRounds(tables: MahjongCsCanvasTable[], rules: GameCsRules = MAHJONG_CS_RULES): { rounds: MahjongCsRound[]; errors: string[] } {
  if (tables.length === 0) return { rounds: [], errors: ["卓がありません"] };
  const errors: string[] = [];
  const byId = new Map(tables.map((t) => [t.id, t]));
  for (const t of tables) {
    if (t.to !== null && (t.to === t.id || !byId.has(t.to))) errors.push(`卓(${t.id}): 矢印の先の卓がありません`);
  }
  const thirds = thirdPlaceIds(tables, rules);
  for (const t of tables) {
    if (t.loserTo == null) continue;
    if (!rules.loserArrow) errors.push(`卓(${t.id}): 敗者の矢印は使えません`);
    else if (t.loserTo === t.id || !byId.has(t.loserTo)) errors.push(`卓(${t.id}): 敗者の矢印の先の卓がありません`);
    else if (t.loserTo === t.to) errors.push(`卓(${t.id}): 敗者の矢印は勝者の矢印と別の卓へ引いてください`);
    else if (t.to === null) errors.push(`卓(${t.id}): 矢印が出ていない卓から敗者の矢印は引けません`);
    // 敗者の矢印は準決勝（勝者の矢印が決勝＝矢印の出ていない卓へ入る卓）からだけ
    else if (byId.get(t.to)?.to !== null) errors.push(`卓(${t.id}): 敗者の矢印は準決勝（勝者が決勝へ進む卓）からだけ引けます`);
    else if (!thirds.has(t.loserTo)) errors.push(`卓(${t.id}): 敗者の矢印は3位決定戦（矢印が出ていない卓）へ引いてください`);
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
  const finals = tables.filter((t) => t.to === null && !thirds.has(t.id)).length;
  if (finals !== 1) errors.push(`決勝（矢印が出ていない卓）は1つにしてください（今 ${finals} 卓）`);
  if (thirds.size > 1) errors.push(`3位決定戦は1つにしてください（今 ${thirds.size} 卓）`);
  if (errors.length > 0) return { rounds: [], errors };

  // グラフが正常なときだけ決勝までの距離で段を決める
  const levels = new Map<number, MahjongCsCanvasTable[]>();
  for (const t of tables) {
    if (thirds.has(t.id)) continue;
    let depth = 0;
    let current = t;
    while (current.to !== null) { current = byId.get(current.to)!; depth++; }
    levels.set(depth, [...(levels.get(depth) ?? []), t]);
  }
  const maxDepth = Math.max(...levels.keys());
  const toMatch = (t: MahjongCsCanvasTable, matchLabel: string) => {
    const seats: MahjongCsSeat[] = [];
    for (const source of tables.filter((s) => s.to === t.id).sort(leftOrder)) {
      if (!validAdvance(source.advanceCount)) continue;
      for (let place = 1; place <= source.advanceCount; place++) {
        seats.push({ kind: "ticket", fromMatchId: source.id, place });
      }
    }
    // 敗者の矢印: 2人卓の2位（＝敗者）の札。勝ち上がりの処理は札のままで増やさない
    for (const source of tables.filter((s) => s.loserTo === t.id).sort(leftOrder)) {
      seats.push({ kind: "ticket", fromMatchId: source.id, place: 2 });
    }
    seats.push(...t.playerIds.map((lineUserId) => ({ kind: "player" as const, lineUserId })));
    if (seats.length > rules.maxSeats) errors.push(`${matchLabel}: 席が足りません（${seats.length}名入ります）`);
    while (seats.length < rules.minSeats) seats.push(null);
    if (!validAdvance(t.advanceCount)) errors.push(`${matchLabel}: 勝ち抜け人数は1〜3名にしてください`);
    return { matchId: t.id, label: matchLabel, players: [], status: "reporting" as const, seats, advanceCount: t.advanceCount };
  };
  const rounds: MahjongCsRound[] = [...levels.keys()].sort((a, b) => b - a).map((depth) => {
    const label = depth === 0 ? "決勝" : depth === 1 ? "準決勝" : depth === 2 ? "準々決勝"
      : maxDepth === 3 ? "予選" : `予選${maxDepth - depth + 1}回戦`;
    const group = levels.get(depth)!.sort(leftOrder);
    return {
      type: depth === 0 ? "final" : "prelim", label, advanceCount: group[0].advanceCount,
      matches: group.map((t, index) => toMatch(t, t.name ?? `${label}${group.length === 1 ? "" : tableLetter(index)}卓`)),
    };
  });
  // 3位決定戦は決勝の直前のラウンドに置く（最後のラウンド＝決勝のまま）
  for (const id of thirds) {
    const table = byId.get(id)!;
    rounds.splice(rounds.length - 1, 0, {
      type: "third", label: "3位決定戦", advanceCount: table.advanceCount, matches: [toMatch(table, table.name ?? "3位決定戦")],
    });
  }
  const labels = new Map<string, number>();
  for (const match of rounds.flatMap(round => round.matches)) labels.set(match.label, (labels.get(match.label) ?? 0) + 1);
  for (const [label, count] of labels) if (count > 1) errors.push(`「${label}」という卓名が重複しています`);
  return { rounds, errors };
}

export function tableLabels(tables: MahjongCsCanvasTable[], rules: GameCsRules = MAHJONG_CS_RULES): Map<string, string> {
  const { rounds } = canvasToRounds(tables, rules);
  return rounds.length > 0
    ? new Map(rounds.flatMap((round) => round.matches.map((match) => [match.matchId, match.label] as const)))
    : new Map([...tables].sort(leftOrder).map((table, index) => [table.id, table.name ?? `卓${tableLetter(index)}`]));
}

export function unplacedIds(draft: CanvasDraft, entrantIds: string[]): string[] {
  const placed = new Set(draft.tables.flatMap((t) => t.playerIds));
  return entrantIds.filter((id) => !placed.has(id));
}

export function initialCanvasDraft(event: Pick<MahjongCsEvent, "bracket">): CanvasDraft {
  return clone({ seedUserIds: event.bracket?.seedUserIds ?? [], tables: event.bracket?.canvas?.tables ?? [] });
}

export function keepEntrants(draft: CanvasDraft, entrantIds: string[]): CanvasDraft {
  const entrants = new Set(entrantIds);
  return {
    seedUserIds: draft.seedUserIds.filter(id => entrants.has(id)),
    tables: draft.tables.map(table => ({ ...table, playerIds: table.playerIds.filter(id => entrants.has(id)) })),
  };
}

export function addTable(d: CanvasDraft, id: string, x: number, y: number, advanceCount: number): CanvasDraft {
  const next = clone(d);
  if (!next.tables.some((t) => t.id === id)) next.tables.push({ id, x, y, advanceCount, to: null, playerIds: [] });
  return next;
}

export function removeTable(d: CanvasDraft, id: string): CanvasDraft {
  const next = clone(d);
  next.tables = next.tables.filter((t) => t.id !== id);
  for (const t of next.tables) {
    if (t.to === id) t.to = null;
    if (t.loserTo === id) delete t.loserTo;
  }
  return next;
}

export function renameTable(d: CanvasDraft, id: string, name: string): CanvasDraft {
  const next = clone(d);
  const trimmed = name.trim();
  if (trimmed.length > 20) return next;
  const table = next.tables.find(t => t.id === id);
  if (table) {
    if (trimmed) table.name = trimmed;
    else delete table.name;
  }
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
  // 付け替えで準決勝でなくなったら、敗者の矢印も外す（黙って残すと確定時にだけエラーになる）
  if (from.loserTo != null && (byId.get(toId)!.to !== null || from.loserTo === toId)) delete from.loserTo;
  return next;
}

export function disconnect(d: CanvasDraft, fromId: string): CanvasDraft {
  const next = clone(d);
  const table = next.tables.find((t) => t.id === fromId);
  if (table) {
    table.to = null;
    delete table.loserTo; // 勝者の矢印が無い卓から敗者の矢印は引けない
  }
  return next;
}

/**
 * 敗者の矢印を引く（3位決定戦用）。引けるのは準決勝（勝者の矢印が、矢印の出ていない卓＝決勝へ入る卓）からだけ。
 * 行き先が3位決定戦になっているかは確定時に canvasToRounds が検証する。
 */
export function connectLoser(d: CanvasDraft, fromId: string, toId: string): CanvasDraft {
  const next = clone(d);
  const from = next.tables.find((t) => t.id === fromId);
  if (!from || fromId === toId || from.to === toId || !next.tables.some((t) => t.id === toId)) return next;
  if (next.tables.find((t) => t.id === from.to)?.to !== null) return next;
  from.loserTo = toId;
  return next;
}

export function disconnectLoser(d: CanvasDraft, fromId: string): CanvasDraft {
  const next = clone(d);
  const table = next.tables.find((t) => t.id === fromId);
  if (table) delete table.loserTo;
  return next;
}

export function setTableAdvance(d: CanvasDraft, id: string, n: number): CanvasDraft {
  const next = clone(d);
  const table = next.tables.find((t) => t.id === id);
  if (table && validAdvance(n)) table.advanceCount = n;
  return next;
}

export function placePlayer(d: CanvasDraft, lineUserId: string, tableId: string, maxSeats = MAHJONG_CS_RULES.maxSeats): CanvasDraft {
  const next = clone(d);
  const target = next.tables.find((t) => t.id === tableId);
  if (!target || openSeats(next.tables, tableId, maxSeats) <= 0) return next;
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

export function setTierSeeds(d: CanvasDraft, entrants: MahjongCsEntrant[], tier: string, on: boolean): CanvasDraft {
  const next = clone(d);
  const ids = entrants.filter((e) => e.tier === tier).map((e) => e.lineUserId);
  next.seedUserIds = on ? [...new Set([...next.seedUserIds, ...ids])]
    : next.seedUserIds.filter((id) => !ids.includes(id));
  return next;
}

export function fillEmptySeats(d: CanvasDraft, entrantIds: string[], maxSeats = MAHJONG_CS_RULES.maxSeats): CanvasDraft {
  const next = clone(d);
  const waiting = [...new Set(unplacedIds(next, entrantIds).filter((id) => !next.seedUserIds.includes(id)))];
  const targets = next.tables.filter((t) => !next.tables.some((source) => source.to === t.id || source.loserTo === t.id))
    .sort((a, b) => b.y - a.y || leftOrder(a, b));
  for (const t of targets) t.playerIds.push(...waiting.splice(0, Math.max(0, openSeats(next.tables, t.id, maxSeats))));
  return next;
}
