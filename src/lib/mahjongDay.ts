/**
 * 麻雀リーグ 当日進行（自動卓組み・半荘確定→抜け番で次卓生成）。サーバーで確定。
 * 状態は mahjongDayState（現ラウンド・待機キュー・直近交代）に集約し、管理/利用者で同一参照。
 */

import { getDb } from "@/lib/firebaseAdmin";
import { computeNextRound, type RankedTable, type RotPlayer } from "@/lib/mahjongRotation";
import type { MahjongDayState, MahjongDaySwap, MahjongEntry, MahjongTable, MahjongTableMember } from "@/types";

const LABELS = "ABCDEFGH".split("");
const dayId = (s: string, e: string) => `${s}_${e}`;
const toRot = (m: MahjongTableMember): RotPlayer => ({ lineUserId: m.lineUserId, displayName: m.displayName, pictureUrl: m.pictureUrl });
const minRot = (p: RotPlayer) => ({ lineUserId: p.lineUserId, displayName: p.displayName, pictureUrl: p.pictureUrl ?? "" });
const reportingMembers = (members: RotPlayer[]) =>
  members.map((m) => ({ lineUserId: m.lineUserId, displayName: m.displayName, pictureUrl: m.pictureUrl ?? "", points: null, rank: null, reportedAt: null }));

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

/**
 * 開催日を開始（round1の卓＋dayStateを自動生成）。冪等：dayStateがあれば何もしない。
 * 参加者は支払い済みエントリー（enteredAt昇順＝FIFO）。4人未満は開始しない。
 */
export async function startDay(seasonId: string, eventDate: string, demo = false): Promise<boolean> {
  const db = getDb();
  const dayRef = db.collection("mahjongDayState").doc(dayId(seasonId, eventDate));
  if ((await dayRef.get()).exists) return false;

  // 既にこの開催日の卓があれば（管理者が手組み等）自動生成しない。
  const tblSnap = await db.collection("mahjongTables").where("seasonId", "==", seasonId).get();
  if (tblSnap.docs.some((d) => (d.data() as MahjongTable).eventDate === eventDate)) return false;

  const snap = await db.collection("mahjongEntries").where("seasonId", "==", seasonId).get();
  const participants: RotPlayer[] = snap.docs
    .map((d) => d.data() as MahjongEntry)
    .filter((e) => e.eventDate === eventDate && e.paymentStatus === "paid")
    .sort((a, b) => a.enteredAt.localeCompare(b.enteredAt))
    .map((e) => ({ lineUserId: e.lineUserId, displayName: e.displayName, pictureUrl: e.pictureUrl }));

  const { tables, waiting } = buildInitialDay(participants);
  if (tables.length === 0) return false;

  const now = new Date().toISOString();
  const tag = demo ? { demoDummy: true } : {};
  const batch = db.batch();
  for (const t of tables) {
    batch.set(db.collection("mahjongTables").doc(`tbl-${seasonId}-${eventDate}-r1-${t.label}`), {
      seasonId, eventDate, createdBy: "system", memberIds: t.members.map((m) => m.lineUserId),
      members: reportingMembers(t.members), status: "reporting", round: 1, tableLabel: t.label,
      createdAt: now, updatedAt: now, ...tag,
    });
  }
  batch.set(dayRef, { seasonId, eventDate, round: 1, waiting: waiting.map(minRot), tableLabels: tables.map((t) => t.label), lastSwap: null, updatedAt: now, ...tag });
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

  return db.runTransaction(async (tx) => {
    const daySnap = await tx.get(dayRef);
    if (!daySnap.exists) return null;
    const day = daySnap.data() as MahjongDayState & { demoDummy?: boolean };
    const round = day.round;

    const qSnap = await tx.get(db.collection("mahjongTables").where("seasonId", "==", seasonId));
    const roundTables = qSnap.docs
      .map((d) => d.data() as MahjongTable)
      .filter((t) => t.eventDate === eventDate && (t.round ?? 1) === round)
      .sort((a, b) => (a.tableLabel ?? "").localeCompare(b.tableLabel ?? ""));
    if (roundTables.length === 0 || !roundTables.every((t) => t.status === "completed")) return null;

    const ranked: RankedTable[] = roundTables.map((t) => ({
      label: t.tableLabel ?? "?",
      ranked: t.members.filter((m) => m.rank != null).map((m) => ({ player: toRot(m), rank: m.rank as number })).sort((a, b) => a.rank - b.rank),
    }));
    const result = computeNextRound(ranked, (day.waiting ?? []).map((w) => ({ ...w })));
    const nextRound = round + 1;
    const now = new Date().toISOString();
    const tag = day.demoDummy ? { demoDummy: true } : {};

    for (const t of result.tables) {
      tx.set(db.collection("mahjongTables").doc(`tbl-${seasonId}-${eventDate}-r${nextRound}-${t.label}`), {
        seasonId, eventDate, createdBy: "system", memberIds: t.members.map((m) => m.lineUserId),
        members: reportingMembers(t.members), status: "reporting", round: nextRound, tableLabel: t.label,
        createdAt: now, updatedAt: now, ...tag,
      });
    }
    const swap: MahjongDaySwap = { round, out: result.out.map(minRot), in: result.in.map(minRot), shrunk: result.shrunk, reason: result.reason ?? null };
    tx.set(dayRef, { seasonId, eventDate, round: nextRound, waiting: result.waiting.map(minRot), tableLabels: result.tables.map((t) => t.label), lastSwap: swap, updatedAt: now, ...tag });
    return swap;
  });
}
