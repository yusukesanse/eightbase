/**
 * 【develop 専用 / main へ入れない】麻雀リーグのデモ進行（抜け番ライブ連携）。
 *
 * 当日デモ卓の申告を受け、現ラウンドの全卓を確定→ src/lib/mahjongRotation の
 * computeNextRound で次半荘を自動生成し、当日状態(mahjongDayState)を更新する。
 * 冪等: dayState.round と申告卓の round が一致するときだけ進める。
 * 呼び出しは本番ガード(!isProduction())内から。→ report/route.ts
 */

import { getDb } from "@/lib/firebaseAdmin";
import { computeNextRound, type RankedTable, type RotPlayer } from "@/lib/mahjongRotation";
import type { MahjongDayState, MahjongDaySwap, MahjongTable, MahjongTableMember } from "@/types";

const STD4 = [40000, 30000, 20000, 10000];

const toRot = (m: MahjongTableMember): RotPlayer => ({
  lineUserId: m.lineUserId,
  displayName: m.displayName,
  pictureUrl: m.pictureUrl,
});
const min = (p: RotPlayer) => ({ lineUserId: p.lineUserId, displayName: p.displayName, pictureUrl: p.pictureUrl });

/**
 * 現ラウンド（dayState.round）の全卓を確定し、抜け番で次半荘を生成する。
 * @param myRank 申告者が同卓の場合の自分の順位（他は自動補完。省略時は全卓自動）
 * @returns 「次の卓」モーダル用の交代結果
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

  // 現ラウンドの全卓（demoDummy）を卓順で取得
  const snap = await db.collection("mahjongTables").where("seasonId", "==", seasonId).get();
  const roundTables = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as MahjongTable & { demoDummy?: boolean }) }))
    .filter((t) => t.eventDate === eventDate && (t.round ?? 1) === round && t.demoDummy)
    .sort((a, b) => (a.tableLabel ?? "").localeCompare(b.tableLabel ?? ""));

  if (roundTables.length === 0) return { swap: day?.lastSwap ?? null };

  const batch = db.batch();
  const ranked: RankedTable[] = [];
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
    ranked.push({
      label: t.tableLabel ?? "?",
      ranked: filled.map((m) => ({ player: toRot(m), rank: m.rank as number })).sort((a, b) => a.rank - b.rank),
    });
  }

  const waiting: RotPlayer[] = (day?.waiting ?? []).map((w) => ({ ...w }));
  const result = computeNextRound(ranked, waiting);
  const nextRound = round + 1;

  for (const t of result.tables) {
    const id = `demo-tbl-${seasonId}-${eventDate}-r${nextRound}-${t.label}`;
    batch.set(db.collection("mahjongTables").doc(id), {
      seasonId,
      eventDate,
      createdBy: "system",
      memberIds: t.members.map((m) => m.lineUserId),
      members: t.members.map((m) => ({ lineUserId: m.lineUserId, displayName: m.displayName, pictureUrl: m.pictureUrl ?? "", points: null, rank: null, reportedAt: null })),
      status: "reporting",
      round: nextRound,
      tableLabel: t.label,
      createdAt: nowIso,
      updatedAt: nowIso,
      demoDummy: true,
    });
  }

  const swap: MahjongDaySwap = {
    round,
    out: result.out.map(min),
    in: result.in.map(min),
    shrunk: result.shrunk,
    reason: result.reason ?? null,
  };
  batch.set(dayRef, {
    seasonId,
    eventDate,
    round: nextRound,
    waiting: result.waiting.map(min),
    tableLabels: result.tables.map((t) => t.label),
    lastSwap: swap,
    demoDummy: true,
    updatedAt: nowIso,
  });

  await batch.commit();
  return { swap };
}
