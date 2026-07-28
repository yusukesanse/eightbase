/**
 * ポーカーCS のサーバーグルー（Firestore 依存）。ダーツ `dartsCsServer` の読み替え。
 * - シード算出: シーズンの scores（poker）を合算した順位＝リーグ順位（通算チップ順）。
 * - 自動開始: 締切日到来で初期ブラケットを生成（setup→running）。GET 時に遅延実行。
 * - 公開DTO: 内部 lineUserId を伏せ、isMe / seed を付与。
 */

import { getDb } from "@/lib/firebaseAdmin";
import { todayJst } from "@/lib/date";
import { startPokerCsIfDue, POKER_CS_SEED_COUNT } from "@/lib/pokerCs";
import type { PokerCsEvent, PokerCsEntrant } from "@/types/poker";

/** リーグ未参加者の順位番兵（seed/卓分けで最下位に置く）。 */
export const POKER_CS_NON_LEAGUE_RANK = 100000;

/** そのユーザーのシーズン順位（poker scores の totalScore=獲得チップ合算・降順）。未参加は番兵。 */
export async function resolvePokerSeasonRank(seasonId: string, userId: string): Promise<number> {
  const snap = await getDb().collection("scores").where("seasonId", "==", seasonId).get();
  const totals = new Map<string, number>();
  for (const d of snap.docs) {
    const x = d.data();
    if (x.gameCategory !== "poker") continue;
    totals.set(x.lineUserId, (totals.get(x.lineUserId) ?? 0) + (Number(x.totalScore) || 0));
  }
  const ranked = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const idx = ranked.indexOf(userId);
  return idx >= 0 ? idx + 1 : POKER_CS_NON_LEAGUE_RANK;
}

/**
 * 締切日到来で初期ラウンドを自動生成（GET 時に遅延実行）。
 * 純関数の startPokerCsIfDue を transaction で確定させ、二重生成を防ぐ。
 */
export async function ensurePokerCsStarted(event: PokerCsEvent): Promise<PokerCsEvent> {
  if (startPokerCsIfDue(event, todayJst()) === null) return event; // 事前チェック（安価）
  const db = getDb();
  const ref = db.collection("pokerCsEvents").doc(event.csEventId);
  const updated = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return event;
    const fresh = snap.data() as PokerCsEvent;
    const gen = startPokerCsIfDue(fresh, todayJst());
    if (!gen) return fresh;
    const now = new Date().toISOString();
    tx.update(ref, { rounds: gen.rounds, status: gen.status, updatedAt: now });
    return { ...fresh, rounds: gen.rounds, status: gen.status, updatedAt: now };
  });
  return updated;
}

/** エントリー上位 POKER_CS_SEED_COUNT 名（rank 昇順）の lineUserId 集合＝シード表示。 */
function seedIdSet(entrants: PokerCsEntrant[]): Set<string> {
  if (entrants.length <= POKER_CS_SEED_COUNT) return new Set();
  return new Set(
    [...entrants].sort((a, b) => a.rank - b.rank).slice(0, POKER_CS_SEED_COUNT).map((e) => e.lineUserId)
  );
}

/** 公開DTO（lineUserId を伏せ、isMe / seed を付与）。 */
export function toPublicPokerCs(event: PokerCsEvent, userId: string) {
  const seeds = seedIdSet(event.entrants);
  const nameById = new Map(event.entrants.map((e) => [e.lineUserId, e]));
  const champ = event.championId ? nameById.get(event.championId) : null;
  const podiumName = (id?: string | null) => (id ? nameById.get(id) ?? null : null);

  return {
    csEventId: event.csEventId,
    seasonId: event.seasonId,
    name: event.name,
    eventDate: event.eventDate,
    status: event.status,
    champion: champ ? { displayName: champ.displayName, pictureUrl: champ.pictureUrl ?? "" } : null,
    podium: event.podium
      ? {
          gold: podiumName(event.podium.gold),
          silver: podiumName(event.podium.silver),
          bronze: podiumName(event.podium.bronze),
        }
      : null,
    entrants: event.entrants.map((e) => ({
      displayName: e.displayName,
      pictureUrl: e.pictureUrl ?? "",
      rank: e.rank,
      seed: seeds.has(e.lineUserId),
      isMe: e.lineUserId === userId,
    })),
    rounds: event.rounds.map((r) => ({
      type: r.type,
      label: r.label,
      matches: r.matches.map((m) => ({
        matchId: m.matchId,
        label: m.label,
        status: m.status,
        players: m.players.map((p) => ({
          displayName: p.displayName,
          pictureUrl: p.pictureUrl ?? "",
          chips: p.chips,
          rank: p.rank,
          seed: seeds.has(p.lineUserId),
          isMe: p.lineUserId === userId,
        })),
      })),
    })),
  };
}
