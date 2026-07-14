/**
 * 【develop 専用 / main へ入れない】麻雀リーグのデモ進行（GM 手動振り分け前提）。
 *
 * ダミーは自己申告しないため、「進める」で現ラウンドの未確定卓を確定（demoユーザーは自分の
 * 順位、他ダミーは自動）し、共有の advanceDayIfRoundComplete に委譲する。
 *
 * 麻雀は GM（demoユーザー）の手動卓振り分けに一本化した。advanceDayIfRoundComplete は
 * 次半荘を **awaitingAssignment=true（GM 振り分け待ち）** に戻すだけで、卓は自動生成しない。
 * → デモでも「進める」後は demoユーザー(GM)が GM パネルで次半荘を手動振り分けする。
 *   （かつての「デモは次半荘を自動確定して見せ続ける」スキャフォールドは廃止。
 *    自動卓確定は docs/麻雀リーグ-自動卓確定-廃止.md のとおり全廃した。）
 *
 * 呼び出しは本番ガード(!isProduction())内から。→ /api/mahjong/day
 */

import { getDb } from "@/lib/firebaseAdmin";
import { advanceDayIfRoundComplete } from "@/lib/mahjongDay";
import type { MahjongDayState, MahjongDaySwap, MahjongTable, MahjongTableMember } from "@/types";

const STD4 = [40000, 30000, 20000, 10000];

/**
 * 現ラウンド（dayState.round）の未確定卓を確定（demoユーザーは自分の順位、他ダミーは自動）し、
 * advanceDayIfRoundComplete に委譲する。全卓が確定していれば次 round を GM 振り分け待ちに戻す。
 */
export async function advanceDemoDay(
  seasonId: string,
  eventDate: string,
  userId: string,
  myRank?: number
): Promise<{ swap: MahjongDaySwap | null }> {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const dayRef = db.collection("mahjongDayState").doc(`${seasonId}_${eventDate}`);
  const daySnap = await dayRef.get();
  const day = daySnap.exists ? (daySnap.data() as MahjongDayState) : null;
  const round = day?.round ?? 1;

  // 当日分だけ読む（等値2条件なので複合インデックス不要）。
  const snap = await db
    .collection("mahjongTables")
    .where("seasonId", "==", seasonId)
    .where("eventDate", "==", eventDate)
    .get();
  const roundTables = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as MahjongTable) }))
    .filter((t) => (t.round ?? 1) === round);

  // 現ラウンドの未確定卓を確定する（フラグに依存せず未確定卓を対象＝デモ限定なので安全）。
  const pending = roundTables.filter((t) => t.status !== "completed");
  const batch = db.batch();
  let writes = 0;
  for (const t of pending) {
    const hasMe = t.members.some((m) => m.lineUserId === userId);
    let filled: MahjongTableMember[];
    if (hasMe && myRank) {
      const others = [1, 2, 3, 4].filter((r) => r !== myRank);
      let oi = 0;
      filled = t.members.map((m) => {
        const rank = m.lineUserId === userId ? myRank : others[oi++];
        return { ...m, rank, points: STD4[rank - 1], reportedAt: nowIso };
      });
    } else {
      filled = t.members.map((m, i) => ({ ...m, rank: i + 1, points: STD4[i], reportedAt: nowIso }));
    }
    batch.update(db.collection("mahjongTables").doc(t.id), { members: filled, status: "completed", updatedAt: nowIso });
    writes++;
  }
  if (writes > 0) await batch.commit();

  // 現半荘を埋めたら共有ロジックに委譲。GM（手動）シーズンでは次 round を
  // awaitingAssignment=true（GM 振り分け待ち）に戻すだけで、卓は自動生成しない。
  // → demoユーザー(GM)が GM パネルで次半荘を手動振り分けする。
  const swap = await advanceDayIfRoundComplete(seasonId, eventDate);
  return { swap };
}
