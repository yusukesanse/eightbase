/**
 * 【develop 専用 / main へ入れない】麻雀リーグのデモ進行（抜け番ライブ連携）。
 *
 * ダミーは自己申告しないため、現ラウンドの全卓をデモで埋めて確定させ、共有の
 * advanceDayIfRoundComplete（src/lib/mahjongDay）に委譲して次半荘を自動生成する。
 * 呼び出しは本番ガード(!isProduction())内から。→ /api/mahjong/day
 */

import { getDb } from "@/lib/firebaseAdmin";
import { advanceDayIfRoundComplete } from "@/lib/mahjongDay";
import type { MahjongDayState, MahjongDaySwap, MahjongTable, MahjongTableMember } from "@/types";

const STD4 = [40000, 30000, 20000, 10000];

/**
 * 現ラウンド（dayState.round）の全卓を確定（demoユーザーは自分の順位、他ダミーは自動）し、
 * 抜け番で次半荘を生成する。
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

  const snap = await db.collection("mahjongTables").where("seasonId", "==", seasonId).get();
  const roundTables = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as MahjongTable & { demoDummy?: boolean }) }))
    .filter((t) => t.eventDate === eventDate && (t.round ?? 1) === round && t.demoDummy && t.status !== "completed");

  const batch = db.batch();
  for (const t of roundTables) {
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
  }
  await batch.commit();

  const swap = await advanceDayIfRoundComplete(seasonId, eventDate);
  return { swap };
}
