/**
 * 【develop 専用 / main へ入れない】麻雀リーグのデモ進行（GM 手動振り分け前提）。
 *
 * ダミーは自己申告しないため、デモではダミー分の申告を代行する。2つの粒度がある:
 *  - reportOneDemoDummy … ダミー**1名分だけ**申告する。GM パネルの申告進捗が1人ずつ増え、
 *    「各自が申告→全員揃うと卓確定→両卓揃うと次半荘」という実運用の流れを追体験できる。
 *  - advanceDemoDay … 現ラウンドの未確定卓を**一括**確定する（時短用）。
 *
 * どちらも**既に申告済みの行（demoユーザー自身の本申告を含む）は上書きしない**。
 * demoユーザー自身のスコアは本番同様 /api/mahjong/tables/:id/report で申告する。
 *
 * 麻雀は GM（demoユーザー）の手動卓振り分けに一本化した。advanceDayIfRoundComplete は
 * 次半荘を **awaitingAssignment=true（GM 振り分け待ち）** に戻すだけで、卓は自動生成しない。
 * → デモでも半荘が終わるたび demoユーザー(GM)が GM パネルで次半荘を手動振り分けする。
 *
 * 呼び出しは本番ガード(!isProduction())内から。→ /api/mahjong/day
 */

import { getDb } from "@/lib/firebaseAdmin";
import { advanceDayIfRoundComplete } from "@/lib/mahjongDay";
import type { MahjongDayState, MahjongDaySwap, MahjongTable, MahjongTableMember } from "@/types";

const STD4 = [40000, 30000, 20000, 10000];
const TOTAL_POINTS = 100000;

const isReported = (m: MahjongTableMember) => m.rank != null || !!m.reportedAt;

/** 卓内で未使用の順位のうち最小を返す（1〜4）。 */
function nextFreeRank(members: MahjongTableMember[]): number {
  const used = new Set(members.filter(isReported).map((m) => m.rank));
  for (let r = 1; r <= 4; r++) if (!used.has(r)) return r;
  return 4;
}

/**
 * ダミーに与える点数。最後の1人なら合計が100,000点になるよう調整し、
 * それ以外は順位の標準点（実申告の点数と混ざっても合計が破綻しない）。
 */
function pointsFor(members: MahjongTableMember[], rank: number, isLastUnreported: boolean): number {
  if (!isLastUnreported) return STD4[rank - 1];
  const sum = members.filter(isReported).reduce((n, m) => n + (m.points ?? 0), 0);
  return TOTAL_POINTS - sum;
}

/** 現ラウンドの卓（ラベル昇順）を取得する。当日分だけ読む（等値2条件＝複合インデックス不要）。 */
async function fetchRoundTables(seasonId: string, eventDate: string) {
  const db = getDb();
  const daySnap = await db.collection("mahjongDayState").doc(`${seasonId}_${eventDate}`).get();
  const day = daySnap.exists ? (daySnap.data() as MahjongDayState) : null;
  const round = day?.round ?? 1;

  const snap = await db
    .collection("mahjongTables")
    .where("seasonId", "==", seasonId)
    .where("eventDate", "==", eventDate)
    .get();
  const roundTables = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as MahjongTable) }))
    .filter((t) => (t.round ?? 1) === round)
    .sort((a, b) => (a.tableLabel ?? "").localeCompare(b.tableLabel ?? ""));
  return { round, roundTables };
}

export interface DemoStepResult {
  /** 代行申告したダミー（無ければ null）。 */
  filled: { tableLabel: string; displayName: string } | null;
  /** このステップで確定した卓ラベル（無ければ null）。 */
  completedTable: string | null;
  /** 残りが demoユーザー本人の申告だけ（アプリの「スコアを申告する」から申告してもらう）。 */
  needsSelf: boolean;
  swap: MahjongDaySwap | null;
}

/**
 * 現ラウンドのダミー**1名分だけ**申告を代行する。
 * - 対象はラベル順で最初の未確定卓の、最初の未申告ダミー（selfUserId 以外）。
 * - 4人全員の申告が揃った卓は確定（completed）し、全卓揃えば次半荘（振り分け待ち）へ。
 * - 未確定卓に残る未申告が demoユーザー本人だけなら、何もせず needsSelf=true を返す。
 * - 全員申告済みなのに未確定の卓（実申告との合計が合わず自動確定しなかった等）は確定させる。
 */
export async function reportOneDemoDummy(
  seasonId: string,
  eventDate: string,
  selfUserId: string
): Promise<DemoStepResult> {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const { roundTables } = await fetchRoundTables(seasonId, eventDate);
  const pending = roundTables.filter((t) => t.status !== "completed");

  let filled: DemoStepResult["filled"] = null;
  let completedTable: string | null = null;
  let needsSelf = false;

  for (const t of pending) {
    const unreported = t.members.filter((m) => !isReported(m));

    // 全員申告済みなのに未確定（実申告との合計ズレで自動確定しなかった等）→ デモでは確定させる。
    if (unreported.length === 0) {
      await db.collection("mahjongTables").doc(t.id).update({ status: "completed", updatedAt: nowIso });
      completedTable = t.tableLabel ?? null;
      break;
    }

    const dummy = unreported.find((m) => m.lineUserId !== selfUserId);
    if (!dummy) {
      // この卓の残りは demoユーザー本人だけ。本人にアプリから申告してもらう。
      needsSelf = true;
      continue; // 次の卓にダミーが残っていればそちらを進める
    }

    const rank = nextFreeRank(t.members);
    const points = pointsFor(t.members, rank, unreported.length === 1);
    const members = t.members.map((m) =>
      m.lineUserId === dummy.lineUserId ? { ...m, rank, points, reportedAt: nowIso } : m
    );
    const done = members.every(isReported);
    await db.collection("mahjongTables").doc(t.id).update({
      members,
      ...(done ? { status: "completed" } : {}),
      updatedAt: nowIso,
    });
    filled = { tableLabel: t.tableLabel ?? "?", displayName: dummy.displayName };
    if (done) completedTable = t.tableLabel ?? null;
    needsSelf = false;
    break;
  }

  // 卓が確定したら共有ロジックへ委譲（全卓揃えば次 round を GM 振り分け待ちに戻す）。
  const swap = completedTable ? await advanceDayIfRoundComplete(seasonId, eventDate) : null;
  return { filled, completedTable, needsSelf, swap };
}

/**
 * 現ラウンド（dayState.round）の未確定卓を**一括**確定する（時短用）。
 * 申告済みの行はそのまま残し、未申告だけを埋める（demoユーザーの本申告を上書きしない）。
 * demoユーザーが未申告で myRank 指定があれば、その順位を demoユーザーに割り当てる。
 */
export async function advanceDemoDay(
  seasonId: string,
  eventDate: string,
  userId: string,
  myRank?: number
): Promise<{ swap: MahjongDaySwap | null }> {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const { roundTables } = await fetchRoundTables(seasonId, eventDate);

  // 現ラウンドの未確定卓を確定する（フラグに依存せず未確定卓を対象＝デモ限定なので安全）。
  const pending = roundTables.filter((t) => t.status !== "completed");
  const batch = db.batch();
  let writes = 0;
  for (const t of pending) {
    const members = t.members.map((m) => ({ ...m }));

    // demoユーザーが未申告で順位指定があれば先に確保する。
    const me = members.find((m) => m.lineUserId === userId);
    if (me && !isReported(me) && myRank && !members.some((m) => isReported(m) && m.rank === myRank)) {
      me.rank = myRank;
      me.points = STD4[myRank - 1];
      me.reportedAt = nowIso;
    }

    // 残りの未申告を順位の若い順に埋める。最後の1人は合計100,000点になるよう調整。
    for (const m of members) {
      if (isReported(m)) continue;
      const rank = nextFreeRank(members);
      const isLast = members.filter((x) => !isReported(x)).length === 1;
      m.rank = rank;
      m.points = pointsFor(members, rank, isLast);
      m.reportedAt = nowIso;
    }

    batch.update(db.collection("mahjongTables").doc(t.id), { members, status: "completed", updatedAt: nowIso });
    writes++;
  }
  if (writes > 0) await batch.commit();

  // 現半荘を埋めたら共有ロジックに委譲。GM（手動）シーズンでは次 round を
  // awaitingAssignment=true（GM 振り分け待ち）に戻すだけで、卓は自動生成しない。
  // → demoユーザー(GM)が GM パネルで次半荘を手動振り分けする。
  const swap = await advanceDayIfRoundComplete(seasonId, eventDate);
  return { swap };
}
