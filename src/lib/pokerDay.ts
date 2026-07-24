/**
 * ポーカーリーグ 当日進行（ディーラー主導・複数試合）の状態機械。
 * 要件: docs/games/poker/ポーカー-ルール草案.md §4〜§6。
 *
 * 麻雀/ダーツ/ビリヤードと違い **シーズンGMを置かない**。各試合ごとに参加者の誰かが
 * 「ディーラーをやる」で自己選出し、進行（ゲーム開始/終了/確定）を行う。1日に複数試合。
 * 状態は pokerDayState/{seasonId}_{eventDate} の単一 doc に集約（＝唯一の真実）。
 *
 * 当日フロー（1試合）:
 *   ①ディーラーをやる（assignPokerDealer）→ 末尾に game{status:"ready"}
 *   ②ディーラーがゲーム開始（startPokerGame）→ 最初の試合なら participants 確定＋受付締切。status:"playing"
 *   ③ディーラーがゲーム終了（endPokerGame）→ status:"reporting"
 *   ④各プレイヤーがチップ残高を申告（reportPokerChips）
 *   ⑤ディーラーが確認して確定（confirmPokerGame）→ status:"confirmed"・当日 scores を再集計 upsert
 *   → ①へ（次の試合のディーラー選択）
 * 中止（流会）は管理者のみ（cancelPokerDay）。確定済みの試合があれば中止不可。
 *
 * 順位・チップ合計は保存せず reports から都度算出（ディーラー修正時の陳腐化を防ぐ）。
 * Firestore 読み取り節約: エントリー取得は where(seasonId==).where(eventDate==) の等値2条件。
 */

import { getDb } from "@/lib/firebaseAdmin";
import { deriveStatus } from "@/lib/pokerEntryStatus";
import { isScheduledPokerDate } from "@/lib/pokerSchedule";
import { computePokerDay, rankByChips } from "@/lib/pokerScore";
import {
  POKER_MIN_PARTICIPANTS,
  POKER_INITIAL_CHIPS,
  POKER_ENTRY_FEE,
  type PokerEntry,
  type PokerDayMember,
  type PokerDayState,
  type PokerGameState,
  type PokerScoreDetails,
} from "@/types/poker";

export const pokerDayId = (seasonId: string, eventDate: string) => `${seasonId}_${eventDate}`;

/** 当日の状態を取得（未開始なら null）。 */
export async function getPokerDayState(
  seasonId: string,
  eventDate: string
): Promise<PokerDayState | null> {
  const snap = await getDb().collection("pokerDayState").doc(pokerDayId(seasonId, eventDate)).get();
  return snap.exists ? (snap.data() as PokerDayState) : null;
}

/** この開催日の受付（参加表明・支払い）が締め切られているか＝最初の試合が「ゲーム開始」されたか。 */
export function isPokerEntryClosed(day: PokerDayState | null): boolean {
  return !!day?.entryClosedAt;
}

/** エントリー doc 群から支払い済み参加者を FIFO（enteredAt 昇順）で抽出。 */
function paidParticipantsFromDocs(
  docs: FirebaseFirestore.QueryDocumentSnapshot[]
): PokerDayMember[] {
  return docs
    .map((d) => ({ ...(d.data() as PokerEntry), entryId: d.id }))
    .filter((e) => deriveStatus(e) === "paid")
    .sort((a, b) => a.enteredAt.localeCompare(b.enteredAt))
    .map((e) => ({ lineUserId: e.lineUserId, displayName: e.displayName, pictureUrl: e.pictureUrl }));
}

/** 支払い済み参加者（staff は POST 時点で paid）。enteredAt 昇順 FIFO。 */
export async function fetchPokerParticipants(
  seasonId: string,
  eventDate: string
): Promise<PokerDayMember[]> {
  const snap = await getDb()
    .collection("pokerEntries")
    .where("seasonId", "==", seasonId)
    .where("eventDate", "==", eventDate)
    .get();
  return paidParticipantsFromDocs(snap.docs);
}

const currentGame = (day: PokerDayState): PokerGameState | undefined => day.games[day.games.length - 1];

export type DayMutationResult =
  | { ok: true; already?: boolean }
  | { ok: false; status: number; error: string };

// ─── ①ディーラーをやる（次の試合のディーラーを自己選出・確定） ────────────────

/**
 * 参加者の誰かが「ディーラーをやる」。次の試合のディーラーになる。
 * - dayState 未作成なら作成（受付はまだ開いたまま。participants は「ゲーム開始」で確定）。
 * - 末尾の試合が ready（未開始）なら、ディーラーを差し替える（押し間違いの訂正）。
 * - 末尾が confirmed（または games 空）なら新しい試合を追加。playing/reporting 中は不可（409）。
 * - dealerId は支払い済み参加者（締切後は確定参加者）でなければならない。
 */
export async function assignPokerDealer(
  seasonId: string,
  eventDate: string,
  dealerId: string
): Promise<DayMutationResult> {
  const db = getDb();
  if (!(await isScheduledPokerDate(seasonId, eventDate))) {
    return { ok: false, status: 400, error: "開催日ではありません" };
  }
  const dayRef = db.collection("pokerDayState").doc(pokerDayId(seasonId, eventDate));
  const cancelRef = db.collection("pokerCancelledDates").doc(eventDate);
  const entriesQuery = db
    .collection("pokerEntries")
    .where("seasonId", "==", seasonId)
    .where("eventDate", "==", eventDate);

  return db.runTransaction(async (tx) => {
    const [snap, cancelSnap, entriesSnap] = await Promise.all([tx.get(dayRef), tx.get(cancelRef), tx.get(entriesQuery)]);
    if (cancelSnap.exists) return { ok: false as const, status: 409, error: "この開催日は中止されました" };
    const now = new Date().toISOString();

    if (!snap.exists) {
      // 受付前: 現在の支払い済みからディーラー資格を確認。participants は開始時に確定する。
      const paid = paidParticipantsFromDocs(entriesSnap.docs);
      if (!paid.some((p) => p.lineUserId === dealerId)) {
        return { ok: false as const, status: 403, error: "参加者（支払い済み）のみディーラーになれます" };
      }
      if (paid.length < POKER_MIN_PARTICIPANTS) {
        return { ok: false as const, status: 409, error: `参加者が${POKER_MIN_PARTICIPANTS}名以上必要です` };
      }
      const day: PokerDayState = {
        seasonId,
        eventDate,
        participants: [],
        entryClosedAt: null,
        games: [{ gameIndex: 1, dealerId, status: "ready", reports: {} }],
        finishedAt: null,
        finishedBy: null,
        updatedAt: now,
      };
      tx.set(dayRef, day);
      return { ok: true as const };
    }

    const day = snap.data() as PokerDayState;
    if (day.finishedAt) return { ok: false as const, status: 409, error: "本日は終了しています" };

    // ディーラー資格: 受付後は確定参加者、受付前は支払い済み。
    const eligible = day.entryClosedAt
      ? day.participants.some((p) => p.lineUserId === dealerId)
      : paidParticipantsFromDocs(entriesSnap.docs).some((p) => p.lineUserId === dealerId);
    if (!eligible) return { ok: false as const, status: 403, error: "参加者のみディーラーになれます" };

    const last = currentGame(day);
    if (last && (last.status === "playing" || last.status === "reporting")) {
      return { ok: false as const, status: 409, error: "進行中の試合があります" };
    }
    if (last && last.status === "ready") {
      // 未開始の試合のディーラーを差し替え（訂正）。
      last.dealerId = dealerId;
    } else {
      // 末尾が confirmed（または games 空）→ 新しい試合を追加。
      day.games.push({ gameIndex: day.games.length + 1, dealerId, status: "ready", reports: {} });
    }
    day.updatedAt = now;
    tx.set(dayRef, day);
    return { ok: true as const };
  });
}

// ─── ②ゲーム開始（ディーラーのみ・最初の試合で受付締切＋参加者確定） ──────────

export async function startPokerGame(
  seasonId: string,
  eventDate: string,
  actorId: string
): Promise<DayMutationResult> {
  const db = getDb();
  const dayRef = db.collection("pokerDayState").doc(pokerDayId(seasonId, eventDate));
  const entriesQuery = db
    .collection("pokerEntries")
    .where("seasonId", "==", seasonId)
    .where("eventDate", "==", eventDate);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(dayRef);
    if (!snap.exists) return { ok: false as const, status: 400, error: "まだディーラーが決まっていません" };
    const day = snap.data() as PokerDayState;
    if (day.finishedAt) return { ok: false as const, status: 409, error: "本日は終了しています" };
    const game = currentGame(day);
    if (!game || game.status !== "ready") {
      return { ok: false as const, status: 409, error: "開始できる試合がありません" };
    }
    if (game.dealerId !== actorId) {
      return { ok: false as const, status: 403, error: "この試合のディーラーのみ開始できます" };
    }

    const now = new Date().toISOString();
    // 最初の試合: 受付締切＋参加者確定。
    if (!day.entryClosedAt) {
      const entriesSnap = await tx.get(entriesQuery);
      const participants = paidParticipantsFromDocs(entriesSnap.docs);
      if (participants.length < POKER_MIN_PARTICIPANTS) {
        return { ok: false as const, status: 409, error: `参加者が${POKER_MIN_PARTICIPANTS}名以上必要です` };
      }
      if (!participants.some((p) => p.lineUserId === game.dealerId)) {
        return { ok: false as const, status: 409, error: "ディーラーが参加者に含まれていません" };
      }
      day.participants = participants;
      day.entryClosedAt = now;
    }

    game.status = "playing";
    game.startedAt = now;
    day.updatedAt = now;
    tx.set(dayRef, day);
    return { ok: true as const };
  });
}

// ─── ③ゲーム終了（ディーラーのみ・申告受付へ） ───────────────────────────────

export async function endPokerGame(
  seasonId: string,
  eventDate: string,
  actorId: string
): Promise<DayMutationResult> {
  const db = getDb();
  const dayRef = db.collection("pokerDayState").doc(pokerDayId(seasonId, eventDate));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(dayRef);
    if (!snap.exists) return { ok: false as const, status: 400, error: "まだ開始していません" };
    const day = snap.data() as PokerDayState;
    if (day.finishedAt) return { ok: false as const, status: 409, error: "本日は終了しています" };
    const game = currentGame(day);
    if (!game || game.status !== "playing") {
      return { ok: false as const, status: 409, error: "終了できる試合がありません" };
    }
    if (game.dealerId !== actorId) {
      return { ok: false as const, status: 403, error: "この試合のディーラーのみ終了できます" };
    }
    const now = new Date().toISOString();
    game.status = "reporting";
    game.endedAt = now;
    day.updatedAt = now;
    tx.set(dayRef, day);
    return { ok: true as const };
  });
}

// ─── ④チップ申告（プレイヤー本人／ディーラー代理） ───────────────────────────

/** その試合のプレイヤー（＝参加者からディーラーを除いた全員）。 */
function playersOfGame(day: PokerDayState, game: PokerGameState): string[] {
  return day.participants.map((p) => p.lineUserId).filter((id) => id !== game.dealerId);
}

export async function reportPokerChips(
  seasonId: string,
  eventDate: string,
  actorId: string,
  chips: number,
  opts: { targetUserId?: string }
): Promise<DayMutationResult> {
  const db = getDb();
  const dayRef = db.collection("pokerDayState").doc(pokerDayId(seasonId, eventDate));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(dayRef);
    if (!snap.exists) return { ok: false as const, status: 400, error: "まだ開始していません" };
    const day = snap.data() as PokerDayState;
    if (day.finishedAt) return { ok: false as const, status: 409, error: "本日は終了しています" };
    const game = currentGame(day);
    if (!game || game.status !== "reporting") {
      return { ok: false as const, status: 409, error: "いまは申告できません" };
    }

    const isDealer = actorId === game.dealerId;
    const targetId = isDealer && opts.targetUserId ? opts.targetUserId : actorId;
    if (!isDealer && opts.targetUserId && opts.targetUserId !== actorId) {
      return { ok: false as const, status: 403, error: "他の人の代理申告はできません（ディーラーのみ可）" };
    }
    const players = playersOfGame(day, game);
    if (!players.includes(targetId)) {
      return { ok: false as const, status: 403, error: "この試合のプレイヤーではありません" };
    }

    // チップ: 0〜（初期チップ × プレイヤー人数）＝場の総チップの範囲。
    const maxChips = POKER_INITIAL_CHIPS * players.length;
    if (!Number.isInteger(chips) || chips < 0 || chips > maxChips) {
      return { ok: false as const, status: 400, error: `チップは0〜${maxChips}の整数で入力してください` };
    }

    game.reports[targetId] = { chips, reportedAt: new Date().toISOString() };
    day.updatedAt = new Date().toISOString();
    tx.set(dayRef, day);
    return { ok: true as const };
  });
}

// ─── ⑤ディーラー確定（全員入力後・当日 scores を再集計 upsert） ───────────────

/** 当日の全 confirmed 試合から、参加者ごとの当日成績（totalChips/明細/当日順位）を算出（純粋・テスト可能）。 */
export function computePokerDayScores(day: PokerDayState): {
  lineUserId: string;
  totalScore: number;
  details: PokerScoreDetails;
}[] {
  const confirmed = day.games
    .filter((g) => g.status === "confirmed")
    .map((g) => ({
      gameIndex: g.gameIndex,
      dealerId: g.dealerId,
      reports: Object.fromEntries(Object.entries(g.reports).map(([id, r]) => [id, r.chips])),
    }));
  const perPlayer = computePokerDay(
    confirmed,
    day.participants.map((p) => ({ lineUserId: p.lineUserId, displayName: p.displayName }))
  ).filter((p) => p.gamesPlayed > 0);

  const nameById = new Map(day.participants.map((p) => [p.lineUserId, p.displayName]));
  const dayRank = new Map(
    rankByChips(perPlayer.map((p) => ({ id: p.lineUserId, chips: p.totalChips, name: nameById.get(p.lineUserId) ?? p.lineUserId }))).map(
      (r) => [r.id, r.rank]
    )
  );

  return perPlayer.map((p) => {
    const rank = dayRank.get(p.lineUserId) ?? 0;
    return {
      lineUserId: p.lineUserId,
      totalScore: p.totalChips,
      details: {
        games: p.games,
        totalChips: p.totalChips,
        gamesPlayed: p.gamesPlayed,
        dayRank: rank,
        chipCount: p.totalChips,
        tournamentRank: rank,
      },
    };
  });
}

export async function confirmPokerGame(
  seasonId: string,
  eventDate: string,
  actorId: string
): Promise<DayMutationResult> {
  const db = getDb();
  const dayRef = db.collection("pokerDayState").doc(pokerDayId(seasonId, eventDate));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(dayRef);
    if (!snap.exists) return { ok: false as const, status: 400, error: "まだ開始していません" };
    const day = snap.data() as PokerDayState;
    if (day.finishedAt) return { ok: false as const, status: 409, error: "本日は終了しています" };
    const game = currentGame(day);
    if (!game) return { ok: false as const, status: 409, error: "確定できる試合がありません" };
    if (game.status === "confirmed") return { ok: true as const, already: true };
    if (game.status !== "reporting") {
      return { ok: false as const, status: 409, error: "この試合はまだ申告受付ではありません" };
    }
    if (game.dealerId !== actorId) {
      return { ok: false as const, status: 403, error: "この試合のディーラーのみ確定できます" };
    }
    const players = playersOfGame(day, game);
    if (!players.every((id) => game.reports[id] !== undefined)) {
      return { ok: false as const, status: 409, error: "全員のチップ申告が揃っていません" };
    }

    const now = new Date().toISOString();
    game.status = "confirmed";
    game.confirmedAt = now;
    day.updatedAt = now;
    tx.set(dayRef, day);

    // 当日 scores を再集計して upsert（通算チップ＝シーズン順位の素）。
    const gameId = `poker-${seasonId}-${eventDate}`;
    const yearMonth = eventDate.slice(0, 7);
    const scores = computePokerDayScores(day);
    tx.set(
      db.collection("games").doc(gameId),
      { gameId, gameCategory: "poker", seasonId, eventDate, title: `ポーカーリーグ ${eventDate}`, startAt: eventDate, scoreRegistered: true, updatedAt: now },
      { merge: true }
    );
    const memberById = new Map(day.participants.map((p) => [p.lineUserId, p]));
    for (const s of scores) {
      const m = memberById.get(s.lineUserId);
      tx.set(
        db.collection("scores").doc(`${gameId}-${s.lineUserId}`),
        {
          gameId,
          gameCategory: "poker",
          lineUserId: s.lineUserId,
          displayName: m?.displayName ?? "",
          pictureUrl: m?.pictureUrl ?? "",
          seasonId,
          yearMonth,
          totalScore: s.totalScore,
          details: s.details,
          playedAt: eventDate,
          recordedBy: `dealer:${actorId}`,
          createdAt: now,
        },
        { merge: true }
      );
    }
    return { ok: true as const };
  });
}

// ─── 中止（流会）＝返金対象化（管理者のみ） ─────────────────────────────────

export type PokerCancelResult =
  | { status: "already" }
  | { status: "finished" }
  | { status: "forfeited"; paidCount: number; refundCount: number };

/**
 * 開催日を中止（流会）。支払い済みは返金待ち（cancelRequested）にし、管理者へ一括依頼を通知。
 * 自動返金はしない。冪等。**確定済みの試合があれば中止できない**（成績が既に記録されているため）。
 */
export async function cancelPokerDay(
  seasonId: string,
  eventDate: string,
  byUserId: string
): Promise<PokerCancelResult> {
  const db = getDb();
  const cancelRef = db.collection("pokerCancelledDates").doc(eventDate);
  const dayRef = db.collection("pokerDayState").doc(pokerDayId(seasonId, eventDate));
  const entriesQuery = db
    .collection("pokerEntries")
    .where("seasonId", "==", seasonId)
    .where("eventDate", "==", eventDate);
  const month = eventDate.slice(0, 7);

  return db.runTransaction(async (tx) => {
    const cancelSnap = await tx.get(cancelRef);
    if (cancelSnap.exists) return { status: "already" as const };

    const daySnap = await tx.get(dayRef);
    if (daySnap.exists) {
      const day = daySnap.data() as PokerDayState;
      if (day.finishedAt || day.games.some((g) => g.status === "confirmed")) {
        return { status: "finished" as const };
      }
    }

    const entriesSnap = await tx.get(entriesQuery);
    const entries = entriesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as PokerEntry) }));
    const seated = entries.filter((e) => deriveStatus(e) === "paid");
    const reserved = entries.filter((e) => deriveStatus(e) === "reserved");
    const refundable = seated.filter((e) => !!e.paymentTransactionId); // staff は免除＝対象外
    const reservedToDelete = reserved.filter((e) => !e.paymentTransactionId);

    const nowIso = new Date().toISOString();
    tx.create(cancelRef, {
      seasonId,
      eventDate,
      reason: "manual",
      paidCount: seated.length,
      decidedAt: nowIso,
      decidedBy: byUserId,
    });
    for (const e of refundable) {
      tx.set(
        db.collection("pokerEntries").doc(e.id),
        { status: "cancelRequested", paymentStatus: "cancelRequested", cancelReason: "forfeit", cancelRequestedAt: nowIso, updatedAt: nowIso },
        { merge: true }
      );
    }
    for (const e of reservedToDelete) tx.delete(db.collection("pokerEntries").doc(e.id));
    for (const e of [...seated, ...reserved]) {
      tx.delete(db.collection("pokerMonthlyLocks").doc(`${seasonId}_${e.lineUserId}_${month}`));
    }
    if (daySnap.exists) tx.delete(dayRef);

    tx.create(db.collection("adminNotifications").doc(), {
      type: "poker_event_forfeit",
      message: `${eventDate} は中止（流会）。返金対象 ${refundable.length}名（Squareで手動返金）。`,
      data: {
        eventDate,
        paidCount: seated.length,
        refundCount: refundable.length,
        refunds: refundable.map((e) => ({
          entryId: e.id,
          displayName: e.displayName,
          amount: e.paymentAmount ?? POKER_ENTRY_FEE,
          orderId: e.paymentTransactionId ?? null,
        })),
      },
      read: false,
      createdAt: nowIso,
    });

    return { status: "forfeited" as const, paidCount: seated.length, refundCount: refundable.length };
  });
}
