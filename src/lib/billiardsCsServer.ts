/**
 * ビリヤードCS のサーバーグルー（Firestore 依存）。
 * - シード算出: シーズンの scores（billiards）を合算した順位＝リーグ順位。
 * - 自動開始: 締切日到来で初期ブラケットを生成（setup→running）。GET 時に遅延実行。
 * - 公開DTO: 内部 lineUserId を伏せ、isMe / seed を付与。
 */

import { getDb } from "@/lib/firebaseAdmin";
import { todayJst } from "@/lib/date";
import { startBilliardsCsIfDue, BILLIARDS_CS_SEED_COUNT } from "@/lib/billiardsCs";
import type { BilliardsCsEvent, BilliardsCsEntrant } from "@/types/billiards";

/** リーグ未参加者の順位番兵（seed/組分けで最下位に置く）。 */
export const BILLIARDS_CS_NON_LEAGUE_RANK = 100000;

/** そのユーザーのシーズン順位（billiards scores の totalScore 合算・降順）。未参加は番兵。 */
export async function resolveBilliardsSeasonRank(seasonId: string, userId: string): Promise<number> {
  const snap = await getDb().collection("scores").where("seasonId", "==", seasonId).get();
  const totals = new Map<string, number>();
  for (const d of snap.docs) {
    const x = d.data();
    if (x.gameCategory !== "billiards") continue;
    totals.set(x.lineUserId, (totals.get(x.lineUserId) ?? 0) + (Number(x.totalScore) || 0));
  }
  const ranked = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const idx = ranked.indexOf(userId);
  return idx >= 0 ? idx + 1 : BILLIARDS_CS_NON_LEAGUE_RANK;
}

/**
 * 締切日到来で初期ラウンドを自動生成（GET 時に遅延実行）。純関数の startBilliardsCsIfDue を
 * transaction で確定させ、二重生成を防ぐ。生成しないときは元の event を返す。
 */
export async function ensureBilliardsCsStarted(event: BilliardsCsEvent): Promise<BilliardsCsEvent> {
  if (startBilliardsCsIfDue(event, todayJst()) === null) return event; // 事前チェック（安価）
  const db = getDb();
  const ref = db.collection("billiardsCsEvents").doc(event.csEventId);
  const updated = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return event;
    const fresh = snap.data() as BilliardsCsEvent;
    const gen = startBilliardsCsIfDue(fresh, todayJst());
    if (!gen) return fresh;
    const now = new Date().toISOString();
    tx.update(ref, { rounds: gen.rounds, status: gen.status, updatedAt: now });
    return { ...fresh, rounds: gen.rounds, status: gen.status, updatedAt: now };
  });
  return updated;
}

/** エントリー上位 BILLIARDS_CS_SEED_COUNT 名（rank 昇順）の lineUserId 集合＝シード表示。 */
function seedIdSet(entrants: BilliardsCsEntrant[]): Set<string> {
  if (entrants.length <= BILLIARDS_CS_SEED_COUNT) return new Set();
  return new Set(
    [...entrants].sort((a, b) => a.rank - b.rank).slice(0, BILLIARDS_CS_SEED_COUNT).map((e) => e.lineUserId)
  );
}

/** 公開DTO（lineUserId を伏せ、isMe / seed を付与）。 */
export function toPublicBilliardsCs(event: BilliardsCsEvent, userId: string) {
  const seeds = seedIdSet(event.entrants);
  const nameById = new Map(event.entrants.map((e) => [e.lineUserId, e]));
  const podiumName = (id?: string | null) => {
    if (!id) return null;
    const e = nameById.get(id);
    return e ? { displayName: e.displayName, pictureUrl: e.pictureUrl ?? "" } : null;
  };

  return {
    csEventId: event.csEventId,
    seasonId: event.seasonId,
    name: event.name,
    eventDate: event.eventDate,
    status: event.status,
    champion: podiumName(event.championId),
    runnerUp: podiumName(event.runnerUpId),
    third: podiumName(event.thirdId),
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
          won: p.won,
          seed: seeds.has(p.lineUserId),
          isMe: p.lineUserId === userId,
        })),
      })),
      byes: (r.byes ?? []).map((p) => ({
        displayName: p.displayName,
        pictureUrl: p.pictureUrl ?? "",
        seed: seeds.has(p.lineUserId),
        isMe: p.lineUserId === userId,
      })),
    })),
  };
}
