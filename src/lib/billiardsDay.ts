/**
 * ビリヤードリーグ 当日進行（GM・試合ログ方式）の状態機械。
 * 要件: docs/games/billiards/ビリヤード-ルール草案.md §2〜§3。
 *
 * ダーツ dartsDay の読み替え。差分:
 *  - 種目進行ではなく **試合ログ**（GMが「対戦カード＋勝敗＋敗者の玉数」を1件ずつ記録）。
 *  - 「本日終了」で当日の全試合を集計し、参加者ごとに scores を書く（勝者14pt/敗者=玉数の累積）。
 *
 * 状態は billiardsDayState/{seasonId}_{eventDate} の単一 doc に集約（＝唯一の真実）。
 * Firestore 読み取り節約: エントリー取得は where(seasonId==).where(eventDate==) の等値2条件。
 */

import { getDb } from "@/lib/firebaseAdmin";
import { deriveStatus } from "@/lib/billiardsEntryStatus";
import { isScheduledBilliardsDate, isBilliardsCancelledDate } from "@/lib/billiardsSchedule";
import { computeBilliardsDay, rankBilliards } from "@/lib/billiardsScore";
import { notifyAdmin } from "@/lib/adminNotify";
import {
  BILLIARDS_MIN_PARTICIPANTS,
  BILLIARDS_MAX_LOSER_BALLS,
  BILLIARDS_ENTRY_FEE,
  type BilliardsDayState,
  type BilliardsDayMember,
  type BilliardsEntry,
  type BilliardsMatchLog,
  type BilliardsScoreDetails,
} from "@/types/billiards";

export const billiardsDayId = (seasonId: string, eventDate: string) => `${seasonId}_${eventDate}`;

/** 当日の状態を取得（未開始なら null）。 */
export async function getBilliardsDayState(
  seasonId: string,
  eventDate: string
): Promise<BilliardsDayState | null> {
  const snap = await getDb().collection("billiardsDayState").doc(billiardsDayId(seasonId, eventDate)).get();
  return snap.exists ? (snap.data() as BilliardsDayState) : null;
}

/** この開催日の受付（参加表明・支払い）が締め切られているか＝GM が「ゲーム開始」を押したか。 */
export function isBilliardsEntryClosed(day: BilliardsDayState | null): boolean {
  return !!day?.entryClosedAt;
}

/** 支払い済み参加者（staff は POST 時点で paid）。enteredAt 昇順 FIFO。 */
export async function fetchBilliardsParticipants(
  seasonId: string,
  eventDate: string
): Promise<BilliardsDayMember[]> {
  const snap = await getDb()
    .collection("billiardsEntries")
    .where("seasonId", "==", seasonId)
    .where("eventDate", "==", eventDate)
    .get();
  return snap.docs
    .map((d) => ({ ...(d.data() as BilliardsEntry), entryId: d.id }))
    .filter((e) => deriveStatus(e) === "paid")
    .sort((a, b) => a.enteredAt.localeCompare(b.enteredAt))
    .map((e) => ({ lineUserId: e.lineUserId, displayName: e.displayName, pictureUrl: e.pictureUrl }));
}

let matchSeq = 0;
function newMatchId(): string {
  matchSeq += 1;
  return `bm${Date.now().toString(36)}_${matchSeq}`;
}

// ─── GM: ゲーム開始（＝受付締切・参加者確定） ────────────────────────────────

export type StartResult =
  | { ok: true; already: boolean; paidCount: number }
  | { ok: false; error: string; paidCount: number };

/**
 * GM の「ゲーム開始」。dayState を作成し受付を締め切る。参加者＝その時点の paid+staff で確定。
 * スケジュール登録済み・未中止の開催日のみ。支払い済みが最少人数未満なら開始しない。冪等。
 */
export async function startBilliardsDay(
  seasonId: string,
  eventDate: string,
  gmUserId: string
): Promise<StartResult> {
  const db = getDb();
  if (!(await isScheduledBilliardsDate(seasonId, eventDate))) {
    return { ok: false, error: "開催日ではありません", paidCount: 0 };
  }
  if (await isBilliardsCancelledDate(eventDate)) {
    return { ok: false, error: "この開催日は中止されました", paidCount: 0 };
  }

  const dayRef = db.collection("billiardsDayState").doc(billiardsDayId(seasonId, eventDate));
  const cancelRef = db.collection("billiardsCancelledDates").doc(eventDate);
  const entriesQuery = db.collection("billiardsEntries").where("seasonId", "==", seasonId).where("eventDate", "==", eventDate);

  return db.runTransaction(async (tx) => {
    const [snap, cancelSnap, entrySnap] = await Promise.all([tx.get(dayRef), tx.get(cancelRef), tx.get(entriesQuery)]);
    const participants = entrySnap.docs
      .map((d) => ({ ...(d.data() as BilliardsEntry), entryId: d.id }))
      .filter((e) => deriveStatus(e) === "paid")
      .sort((a, b) => a.enteredAt.localeCompare(b.enteredAt))
      .map((e) => ({ lineUserId: e.lineUserId, displayName: e.displayName, pictureUrl: e.pictureUrl }));
    if (snap.exists && (snap.data() as BilliardsDayState).entryClosedAt) {
      return { ok: true as const, already: true, paidCount: participants.length };
    }
    if (cancelSnap.exists) return { ok: false as const, error: "この開催日は中止されました", paidCount: participants.length };
    if (participants.length < BILLIARDS_MIN_PARTICIPANTS) {
      return { ok: false as const, error: `支払い済みが${BILLIARDS_MIN_PARTICIPANTS}名以上必要です`, paidCount: participants.length };
    }
    const now = new Date().toISOString();
    const day: BilliardsDayState = {
      seasonId,
      eventDate,
      participants,
      entryClosedAt: now,
      startedBy: gmUserId,
      matches: [],
      finishedAt: null,
      finishedBy: null,
      updatedAt: now,
    };
    tx.set(dayRef, day);
    return { ok: true as const, already: false, paidCount: participants.length };
  });
}

// ─── GM: 試合ログの追加・削除 ────────────────────────────────────────────────

export type DayMutationResult = { ok: true } | { ok: false; status: number; error: string };

/** GM が1試合を記録（勝者/敗者/敗者の落とした玉数）。 */
export async function logBilliardsMatch(
  seasonId: string,
  eventDate: string,
  gmUserId: string,
  input: { winnerId: string; loserId: string; loserBalls: number }
): Promise<DayMutationResult> {
  const db = getDb();
  const dayRef = db.collection("billiardsDayState").doc(billiardsDayId(seasonId, eventDate));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(dayRef);
    if (!snap.exists) return { ok: false as const, status: 400, error: "まだ開始していません" };
    const day = snap.data() as BilliardsDayState;
    if (!day.entryClosedAt) return { ok: false as const, status: 400, error: "先に「ゲーム開始」を押してください" };
    if (day.finishedAt) return { ok: false as const, status: 409, error: "本日は終了済みです" };

    if (input.winnerId === input.loserId) return { ok: false as const, status: 400, error: "勝者と敗者が同じです" };
    const ids = new Set(day.participants.map((p) => p.lineUserId));
    if (!ids.has(input.winnerId) || !ids.has(input.loserId)) {
      return { ok: false as const, status: 400, error: "参加者以外は記録できません" };
    }
    if (!Number.isInteger(input.loserBalls) || input.loserBalls < 0 || input.loserBalls > BILLIARDS_MAX_LOSER_BALLS) {
      return { ok: false as const, status: 400, error: `敗者の玉数は0〜${BILLIARDS_MAX_LOSER_BALLS}で入力してください` };
    }
    const now = new Date().toISOString();
    const match: BilliardsMatchLog = {
      matchId: newMatchId(),
      winnerId: input.winnerId,
      loserId: input.loserId,
      loserBalls: input.loserBalls,
      createdAt: now,
      createdBy: gmUserId,
    };
    day.matches = [...(day.matches ?? []), match];
    day.updatedAt = now;
    tx.set(dayRef, day);
    return { ok: true as const };
  });
}

/** GM が試合ログを1件取り消す。 */
export async function deleteBilliardsMatch(
  seasonId: string,
  eventDate: string,
  matchId: string
): Promise<DayMutationResult> {
  const db = getDb();
  const dayRef = db.collection("billiardsDayState").doc(billiardsDayId(seasonId, eventDate));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(dayRef);
    if (!snap.exists) return { ok: false as const, status: 400, error: "まだ開始していません" };
    const day = snap.data() as BilliardsDayState;
    if (day.finishedAt) return { ok: false as const, status: 409, error: "本日は終了済みです" };
    const next = (day.matches ?? []).filter((m) => m.matchId !== matchId);
    if (next.length === (day.matches ?? []).length) {
      return { ok: false as const, status: 404, error: "対象の試合が見つかりません" };
    }
    day.matches = next;
    day.updatedAt = new Date().toISOString();
    tx.set(dayRef, day);
    return { ok: true as const };
  });
}

// ─── GM: 本日終了（当日集計 → scores） ──────────────────────────────────────

export type FinishResult =
  | { ok: true; already: boolean; participantCount: number }
  | { ok: false; status: number; error: string };

/** 当日の試合ログから、参加者ごとの scores 用データ（点/勝敗/明細/当日順位）を算出（純粋・テスト可能）。 */
export function computeBilliardsDayScores(day: BilliardsDayState): {
  lineUserId: string;
  displayName: string;
  pictureUrl: string;
  totalScore: number;
  details: BilliardsScoreDetails;
}[] {
  const nameById = new Map(day.participants.map((p) => [p.lineUserId, p]));
  const perPlayer = computeBilliardsDay(
    (day.matches ?? []).map((m) => ({ winnerId: m.winnerId, loserId: m.loserId, loserBalls: m.loserBalls })),
    day.participants.map((p) => p.lineUserId)
  );
  const ranks = new Map(
    rankBilliards(
      perPlayer.map((p) => ({
        id: p.lineUserId,
        points: p.points,
        wins: p.wins,
        games: p.wins + p.losses,
        name: nameById.get(p.lineUserId)?.displayName ?? "",
      }))
    ).map((r) => [r.id, r.rank])
  );

  return perPlayer.map((p) => {
    const m = nameById.get(p.lineUserId);
    return {
      lineUserId: p.lineUserId,
      displayName: m?.displayName ?? "",
      pictureUrl: m?.pictureUrl ?? "",
      totalScore: p.points,
      details: {
        matches: p.matches.map((x) => ({
          result: x.result,
          points: x.points,
          opponentId: x.opponentId,
          opponentName: nameById.get(x.opponentId)?.displayName ?? "",
        })),
        wins: p.wins,
        losses: p.losses,
        dayRank: ranks.get(p.lineUserId) ?? 0,
      },
    };
  });
}

/** GM の「本日終了」。当日集計を scores に書く（決定的 docId で upsert・冪等）。 */
export async function finishBilliardsDay(
  seasonId: string,
  eventDate: string,
  gmUserId: string
): Promise<FinishResult> {
  const db = getDb();
  const dayRef = db.collection("billiardsDayState").doc(billiardsDayId(seasonId, eventDate));

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(dayRef);
    if (!snap.exists) return { ok: false as const, status: 400, error: "まだ開始していません" };
    const day = snap.data() as BilliardsDayState;
    if (!day.entryClosedAt) return { ok: false as const, status: 400, error: "まだゲームを開始していません" };
    if (day.finishedAt) return { ok: true as const, already: true, participantCount: day.participants.length };

    const now = new Date().toISOString();
    const gameId = `billiards-${seasonId}-${eventDate}`;
    const yearMonth = eventDate.slice(0, 7);
    const scores = computeBilliardsDayScores(day);

    tx.set(
      db.collection("games").doc(gameId),
      { gameId, gameCategory: "billiards", seasonId, eventDate, title: `ビリヤードリーグ ${eventDate}`, startAt: eventDate, scoreRegistered: true, updatedAt: now },
      { merge: true }
    );
    for (const s of scores) {
      tx.set(
        db.collection("scores").doc(`${gameId}-${s.lineUserId}`),
        {
          gameId,
          gameCategory: "billiards",
          lineUserId: s.lineUserId,
          displayName: s.displayName,
          pictureUrl: s.pictureUrl,
          seasonId,
          yearMonth,
          totalScore: s.totalScore,
          details: s.details,
          playedAt: eventDate,
          recordedBy: `gm:${gmUserId}`,
          createdAt: now,
        },
        { merge: true }
      );
    }
    tx.update(dayRef, { finishedAt: now, finishedBy: gmUserId, updatedAt: now });
    return { ok: true as const, already: false, participantCount: scores.length };
  });
}

// ─── GM: 中止（流会）＝返金対象化 ───────────────────────────────────────────

export type BilliardsCancelResult =
  | { status: "already" }
  | { status: "finished" }
  | { status: "forfeited"; paidCount: number; refundCount: number };

/**
 * 開催日を中止（流会）。支払い済みは返金待ち（cancelRequested）にし、管理者へ一括依頼を通知。
 * 自動返金はしない。冪等。終了済みは中止できない。中止すると dayState は破棄。
 */
export async function cancelBilliardsDay(
  seasonId: string,
  eventDate: string,
  gmUserId: string
): Promise<BilliardsCancelResult> {
  const db = getDb();
  const cancelRef = db.collection("billiardsCancelledDates").doc(eventDate);
  if ((await cancelRef.get()).exists) return { status: "already" };

  const dayRef = db.collection("billiardsDayState").doc(billiardsDayId(seasonId, eventDate));
  const daySnap = await dayRef.get();
  if (daySnap.exists && (daySnap.data() as BilliardsDayState).finishedAt) return { status: "finished" };

  const entrySnap = await db.collection("billiardsEntries").where("seasonId", "==", seasonId).where("eventDate", "==", eventDate).get();
  const entries = entrySnap.docs.map((d) => ({ id: d.id, ...(d.data() as BilliardsEntry) }));
  const seated = entries.filter((e) => deriveStatus(e) === "paid");
  const reserved = entries.filter((e) => deriveStatus(e) === "reserved");

  const nowIso = new Date().toISOString();
  try {
    await cancelRef.create({ seasonId, eventDate, reason: "manual", paidCount: seated.length, decidedAt: nowIso, decidedBy: gmUserId });
  } catch {
    return { status: "already" };
  }

  const refundable = seated.filter((e) => !!e.paymentTransactionId);
  const month = eventDate.slice(0, 7);
  const batch = db.batch();
  for (const e of refundable) {
    batch.set(
      db.collection("billiardsEntries").doc(e.id),
      { status: "cancelRequested", paymentStatus: "cancelRequested", cancelReason: "forfeit", cancelRequestedAt: nowIso, updatedAt: nowIso },
      { merge: true }
    );
  }
  for (const e of reserved) batch.delete(db.collection("billiardsEntries").doc(e.id));
  for (const e of [...seated, ...reserved]) {
    batch.delete(db.collection("billiardsMonthlyLocks").doc(`${seasonId}_${e.lineUserId}_${month}`));
  }
  if (daySnap.exists) batch.delete(dayRef);

  try {
    await batch.commit();
  } catch (e) {
    await cancelRef.delete().catch(() => {});
    throw e;
  }

  await notifyAdmin(
    "billiards_event_forfeit",
    `${eventDate} は中止（流会）。返金対象 ${refundable.length}名（Squareで手動返金）。`,
    {
      eventDate,
      paidCount: seated.length,
      refundCount: refundable.length,
      refunds: refundable.map((e) => ({ entryId: e.id, displayName: e.displayName, amount: e.paymentAmount ?? BILLIARDS_ENTRY_FEE, orderId: e.paymentTransactionId ?? null })),
    }
  );

  return { status: "forfeited", paidCount: seated.length, refundCount: refundable.length };
}
