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
    .filter((t) => t.eventDate === eventDate && (t.round ?? 1) === round);
  // 現ラウンドの未確定卓を確定する。かつて demoDummy フラグ付きの卓だけを対象にしていたが、
  // リセット等でフラグが失われた卓があると確定対象が 0 件になり、advanceDayIfRoundComplete が
  // 「未完了」と判定して swap を返さず、「進める」を押しても画面が変化しない状態になっていた。
  // → フラグに依存せず未確定卓を確定する（PATCH は非本番のみ＝デモ限定なので安全）。
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

  // 「幽霊待機」の解消: ログイン中のデモユーザーが現ラウンドの卓にも待機列にも居ない場合、
  // 待機列の末尾に追加する。これをしないと当日参加者としてシードされていない利用者
  // （ゲスト等）や回転で溢れた利用者が、待機ビューのまま何度進めても着席できず、
  // 「押しても変化しない」ように見えてしまう。次半荘以降で必ず着席させる。
  if (day) {
    const seated = roundTables.some((t) => t.members.some((m) => m.lineUserId === userId));
    const waiting = day.waiting ?? [];
    const inWaiting = waiting.some((w) => w.lineUserId === userId);
    if (!seated && !inWaiting) {
      const u = (await db.collection("users").doc(userId).get()).data() as
        | { displayName?: string; pictureUrl?: string }
        | undefined;
      const me = { lineUserId: userId, displayName: u?.displayName || "あなた", pictureUrl: u?.pictureUrl || "" };
      batch.update(dayRef, { waiting: [...waiting, me], updatedAt: nowIso });
      writes++;
    }
  }

  if (writes > 0) await batch.commit();

  const swap = await advanceDayIfRoundComplete(seasonId, eventDate);
  return { swap };
}
