/**
 * 麻雀リーグ 当日進行（自動卓組み・半荘確定→抜け番で次卓生成）。サーバーで確定。
 * 状態は mahjongDayState（現ラウンド・待機キュー・直近交代）に集約し、管理/利用者で同一参照。
 */

import { getDb } from "@/lib/firebaseAdmin";
import { computeNextRound, type RankedTable, type RotPlayer } from "@/lib/mahjongRotation";
import { writeAuditLog } from "@/lib/auditLog";
import type { MahjongDayState, MahjongDaySwap, MahjongEntry, MahjongTable, MahjongTableMember } from "@/types";

const LABELS = "ABCDEFGH".split("");
const dayId = (s: string, e: string) => `${s}_${e}`;
const toRot = (m: MahjongTableMember): RotPlayer => ({ lineUserId: m.lineUserId, displayName: m.displayName, pictureUrl: m.pictureUrl });
const minRot = (p: RotPlayer) => ({ lineUserId: p.lineUserId, displayName: p.displayName, pictureUrl: p.pictureUrl ?? "" });
const reportingMembers = (members: RotPlayer[]) =>
  members.map((m) => ({ lineUserId: m.lineUserId, displayName: m.displayName, pictureUrl: m.pictureUrl ?? "", points: null, rank: null, reportedAt: null }));

function buildSystemTableDoc(
  seasonId: string,
  eventDate: string,
  round: number,
  tableLabel: string,
  members: RotPlayer[],
  nowIso: string,
  tag: Record<string, unknown>
) {
  return {
    seasonId,
    eventDate,
    createdBy: "system",
    memberIds: members.map((m) => m.lineUserId),
    members: reportingMembers(members),
    status: "reporting",
    round,
    tableLabel,
    createdAt: nowIso,
    updatedAt: nowIso,
    ...tag,
  };
}

async function fetchPaidParticipants(
  seasonId: string,
  eventDate: string
): Promise<RotPlayer[]> {
  const db = getDb();
  const snap = await db.collection("mahjongEntries").where("seasonId", "==", seasonId).get();
  return snap.docs
    .map((d) => d.data() as MahjongEntry)
    .filter((e) => e.eventDate === eventDate && e.paymentStatus === "paid")
    .sort((a, b) => a.enteredAt.localeCompare(b.enteredAt))
    .map((e) => ({
      lineUserId: e.lineUserId,
      displayName: e.displayName,
      pictureUrl: e.pictureUrl,
    }));
}

/** 開催成立に必要な最少人数（支払い済み）。 */
export const MAHJONG_MIN_PARTICIPANTS = 4;

/** 当日の状態を取得（未開始なら null）。 */
export async function getDayState(seasonId: string, eventDate: string): Promise<MahjongDayState | null> {
  const snap = await getDb().collection("mahjongDayState").doc(dayId(seasonId, eventDate)).get();
  return snap.exists ? (snap.data() as MahjongDayState) : null;
}

/**
 * この開催日の受付（参加表明・参加費の支払い）が締め切られているか。
 * 締切は **GM が「ゲーム開始」を押した時刻**（dayState.entryClosedAt）。時刻設定による締切は廃止した。
 */
export function isEntryClosed(day: MahjongDayState | null): boolean {
  return !!day?.entryClosedAt;
}

/**
 * GM の「ゲーム開始」。この開催日の受付を締め切る。
 * - 支払い済みが MAHJONG_MIN_PARTICIPANTS 未満なら開始しない（人数不足）。
 * - 冪等: すでに開始済みなら {ok:true, already:true}。
 * - dayState が無ければ呼び出し側で startDay() を先に済ませておくこと。
 */
export async function startGameDay(
  seasonId: string,
  eventDate: string,
  gmUserId: string
): Promise<{ ok: true; already: boolean; paidCount: number } | { ok: false; error: string; paidCount: number }> {
  const db = getDb();
  const dayRef = db.collection("mahjongDayState").doc(dayId(seasonId, eventDate));
  const paid = await fetchPaidParticipants(seasonId, eventDate);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(dayRef);
    if (!snap.exists) return { ok: false as const, error: "当日はまだ開始できません", paidCount: paid.length };
    const day = snap.data() as MahjongDayState;
    if (day.entryClosedAt) return { ok: true as const, already: true, paidCount: paid.length };
    if (paid.length < MAHJONG_MIN_PARTICIPANTS) {
      return { ok: false as const, error: `支払い済みが${MAHJONG_MIN_PARTICIPANTS}名以上必要です`, paidCount: paid.length };
    }
    tx.update(dayRef, {
      entryClosedAt: new Date().toISOString(),
      startedBy: gmUserId,
      updatedAt: new Date().toISOString(),
    });
    return { ok: true as const, already: false, paidCount: paid.length };
  });
}

/**
 * 参加者から初期卓＋待機を作る。卓は常に最大2卓（A/B・同時最大8名）。
 * 先頭8名をA/B卓に割当、9名以上は待機キュー（FIFO）。座席・待機は participants の順。
 */
export function buildInitialDay(participants: RotPlayer[]): { tables: { label: string; members: RotPlayer[] }[]; waiting: RotPlayer[] } {
  const n = participants.length;
  const nTables = Math.min(2, Math.floor(n / 4)); // 2卓固定（最大8名着席）
  const tables = Array.from({ length: nTables }, (_, i) => ({ label: LABELS[i], members: participants.slice(i * 4, i * 4 + 4) }));
  return { tables, waiting: participants.slice(nTables * 4) };
}

/** 手動卓振り分け（GM）シーズンかどうかを seasonId から判定する。 */
export async function isManualSeason(seasonId: string): Promise<boolean> {
  const doc = await getDb().collection("seasons").doc(seasonId).get();
  const gm = (doc.data()?.gameMasterIds ?? []) as unknown;
  return Array.isArray(gm) && gm.length > 0;
}

/**
 * 開催日を開始（round1の卓＋dayStateを自動生成）。冪等：dayStateがあれば何もしない。
 * 参加者は支払い済みエントリー（enteredAt昇順＝FIFO）。4人未満は開始しない。
 * GM（手動）シーズンでは卓を作らず、dayState を「round1 の振り分け待ち」で初期化する。
 */
export async function startDay(seasonId: string, eventDate: string, demo = false): Promise<boolean> {
  const db = getDb();
  const dayRef = db.collection("mahjongDayState").doc(dayId(seasonId, eventDate));
  if ((await dayRef.get()).exists) return false;

  // 休催日は自動開始しない（休催化後に paid が残っていても卓を組まない）。
  if ((await db.collection("mahjongClosedDates").doc(eventDate).get()).exists) return false;

  // 人数不足で自動中止（流会）確定済みの日は卓を組まない（休催とは別コレクション）。
  if ((await db.collection("mahjongCancelledDates").doc(eventDate).get()).exists) return false;

  // 既にこの開催日の卓があれば（管理者が手組み等）自動生成しない。
  const tblSnap = await db.collection("mahjongTables").where("seasonId", "==", seasonId).get();
  if (tblSnap.docs.some((d) => (d.data() as MahjongTable).eventDate === eventDate)) return false;

  const participants = await fetchPaidParticipants(seasonId, eventDate);
  const now = new Date().toISOString();
  const tag = demo ? { demoDummy: true } : {};

  // GM（手動）シーズン: 卓は作らず dayState のみ生成。round1 は GM が振り分けて確定する。
  // 成立最低人数は自動と同じ4名（4名未満は流会ロジックに委ねる）。
  if (await isManualSeason(seasonId)) {
    if (participants.length < 4) return false;
    await dayRef.set({
      seasonId,
      eventDate,
      round: 1,
      waiting: [],
      tableLabels: [],
      lastSwap: null,
      awaitingAssignment: true,
      updatedAt: now,
      ...tag,
    });
    return true;
  }

  const { tables, waiting } = buildInitialDay(participants);
  if (tables.length === 0) return false;

  const batch = db.batch();
  for (const t of tables) {
    batch.set(
      db.collection("mahjongTables").doc(`tbl-${seasonId}-${eventDate}-r1-${t.label}`),
      buildSystemTableDoc(
        seasonId,
        eventDate,
        1,
        t.label,
        t.members,
        now,
        tag
      )
    );
  }
  batch.set(dayRef, {
    seasonId,
    eventDate,
    round: 1,
    waiting: waiting.map(minRot),
    tableLabels: tables.map((t) => t.label),
    lastSwap: null,
    updatedAt: now,
    ...tag,
  });
  await batch.commit();
  return true;
}

/**
 * 現ラウンドの全卓が完了していれば抜け番で次半荘を生成する。冪等＆競合安全（transaction）。
 * @returns 生成したときは交代結果、未完了/既進行なら null
 */
export async function advanceDayIfRoundComplete(seasonId: string, eventDate: string): Promise<MahjongDaySwap | null> {
  const db = getDb();
  const dayRef = db.collection("mahjongDayState").doc(dayId(seasonId, eventDate));

  // GM（手動）シーズンは自動の次卓生成を行わない。read はトランザクション外で先に判定。
  const manual = await isManualSeason(seasonId);

  const swap = await db.runTransaction(async (tx) => {
    const daySnap = await tx.get(dayRef);
    if (!daySnap.exists) return null;
    const day = daySnap.data() as MahjongDayState & { demoDummy?: boolean };
    const round = day.round;

    const qSnap = await tx.get(
      db.collection("mahjongTables").where("seasonId", "==", seasonId)
    );
    const roundTables = qSnap.docs
      .map((d) => d.data() as MahjongTable)
      .filter((t) => t.eventDate === eventDate && (t.round ?? 1) === round)
      .sort((a, b) => (a.tableLabel ?? "").localeCompare(b.tableLabel ?? ""));
    if (roundTables.length === 0 || !roundTables.every((t) => t.status === "completed")) return null;

    // GM（手動）: 自動で次卓を作らず、次 round を「GM 振り分け待ち」にするだけ。
    if (manual) {
      const now = new Date().toISOString();
      const tag = day.demoDummy ? { demoDummy: true } : {};
      // 次 round に卓が残っていたら消す。自動進行シーズンから GM シーズンへ切り替えた場合、
      // computeNextRound が先に組んだ卓が残っており、これがあると GM が振り分けられない。
      for (const d of qSnap.docs) {
        const t = d.data() as MahjongTable;
        if (t.eventDate === eventDate && (t.round ?? 1) === round + 1) tx.delete(d.ref);
      }
      tx.set(dayRef, {
        seasonId,
        eventDate,
        round: round + 1,
        waiting: [],
        tableLabels: [],
        lastSwap: null,
        awaitingAssignment: true,
        updatedAt: now,
        ...tag,
      });
      return null; // 自動交代なし（swap は生成しない）
    }

    const ranked: RankedTable[] = roundTables.map((t) => ({
      label: t.tableLabel ?? "?",
      ranked: t.members.filter((m) => m.rank != null).map((m) => ({ player: toRot(m), rank: m.rank as number })).sort((a, b) => a.rank - b.rank),
    }));
    const result = computeNextRound(ranked, (day.waiting ?? []).map((w) => ({ ...w })));
    const nextRound = round + 1;
    const now = new Date().toISOString();
    const tag = day.demoDummy ? { demoDummy: true } : {};

    for (const t of result.tables) {
      tx.set(
        db.collection("mahjongTables").doc(`tbl-${seasonId}-${eventDate}-r${nextRound}-${t.label}`),
        buildSystemTableDoc(
          seasonId,
          eventDate,
          nextRound,
          t.label,
          t.members,
          now,
          tag
        )
      );
    }
    const swap: MahjongDaySwap = {
      round,
      out: result.out.map(minRot),
      in: result.in.map(minRot),
      shrunk: result.shrunk,
      reason: result.reason ?? null,
    };
    tx.set(dayRef, {
      seasonId,
      eventDate,
      round: nextRound,
      waiting: result.waiting.map(minRot),
      tableLabels: result.tables.map((t) => t.label),
      lastSwap: swap,
      updatedAt: now,
      ...tag,
    });
    return swap;
  });

  // 監査はコミット後に記録（transaction 再試行での重複を避ける）。
  if (swap) {
    await writeAuditLog({
      eventType: "day.advanced",
      actor: "system",
      target: { date: eventDate },
      meta: {
        round: swap.round,
        nextRound: swap.round + 1,
        out: swap.out.length,
        in: swap.in.length,
        shrunk: swap.shrunk,
        reason: swap.reason,
      },
    });
  }
  return swap;
}
