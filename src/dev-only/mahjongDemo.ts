/**
 * 【develop 専用 / main へ入れない】麻雀リーグのデモ進行（抜け番ライブ連携）。
 *
 * ダミーは自己申告しないため、現ラウンドの全卓をデモで埋めて確定させ、次半荘を生成する。
 * 呼び出しは本番ガード(!isProduction())内から。→ /api/mahjong/day
 *
 * - **非GM（自動進行）シーズン**: 共有の advanceDayIfRoundComplete に委譲（回転を自動生成）。
 * - **GM（手動振り分け）シーズン**: advanceDayIfRoundComplete は次卓を作らず
 *   awaitingAssignment=true（振り分け待ち）で止めるため、GET /day が当日の卓を [] で返し、
 *   demoユーザーが「消える」。デモでは GM が即座に次半荘を振り分けたものとして、回転後の
 *   次半荘を**確定済み(awaitingAssignment:false)**で生成し、卓を見せ続ける（下の分岐）。
 */

import { getDb } from "@/lib/firebaseAdmin";
import { advanceDayIfRoundComplete, isManualSeason } from "@/lib/mahjongDay";
import { computeNextRound, type RankedTable, type RotPlayer } from "@/lib/mahjongRotation";
import type { MahjongDayState, MahjongDaySwap, MahjongTable, MahjongTableMember } from "@/types";

const STD4 = [40000, 30000, 20000, 10000];

const toRotPlayer = (m: { lineUserId: string; displayName: string; pictureUrl?: string }): RotPlayer => ({
  lineUserId: m.lineUserId,
  displayName: m.displayName,
  pictureUrl: m.pictureUrl ?? "",
});

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
  const day = daySnap.exists ? (daySnap.data() as MahjongDayState & { demoDummy?: boolean }) : null;
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

  // 確定後の各卓メンバー（下のランキング生成で使うため保持する）。
  const filledById = new Map<string, MahjongTableMember[]>();
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
    filledById.set(t.id, filled);
    batch.update(db.collection("mahjongTables").doc(t.id), { members: filled, status: "completed", updatedAt: nowIso });
    writes++;
  }

  // 「幽霊待機」の解消: ログイン中のデモユーザーが現ラウンドの卓にも待機列にも居ない場合、
  // 待機列の末尾に追加する。これをしないと当日参加者としてシードされていない利用者
  // （ゲスト等）や回転で溢れた利用者が、待機ビューのまま何度進めても着席できず、
  // 「押しても変化しない」ように見えてしまう。次半荘以降で必ず着席させる。
  const waitingPool: RotPlayer[] = (day?.waiting ?? []).map(toRotPlayer);
  if (day) {
    const seated = roundTables.some((t) => t.members.some((m) => m.lineUserId === userId));
    const inWaiting = waitingPool.some((w) => w.lineUserId === userId);
    if (!seated && !inWaiting) {
      const u = (await db.collection("users").doc(userId).get()).data() as
        | { displayName?: string; pictureUrl?: string }
        | undefined;
      const me: RotPlayer = { lineUserId: userId, displayName: u?.displayName || "あなた", pictureUrl: u?.pictureUrl || "" };
      waitingPool.push(me);
      batch.update(dayRef, { waiting: waitingPool.map(toRotPlayer), updatedAt: nowIso });
      writes++;
    }
  }

  if (writes > 0) await batch.commit();

  // 非GM（自動進行）シーズンは従来どおり共有ロジックに委譲。
  const manual = day ? await isManualSeason(seasonId) : false;
  if (!manual) {
    const swap = await advanceDayIfRoundComplete(seasonId, eventDate);
    return { swap };
  }

  // ── GM（手動）シーズンのデモ進行 ──────────────────────────────────────
  // advanceDayIfRoundComplete は awaitingAssignment=true で止め、GET /day が卓を [] にして
  // demoユーザーが消える。デモでは「GM が即座に次半荘を振り分けた」ものとして、回転後の
  // 次半荘を確定済み(awaitingAssignment:false)で生成し、卓を見せ続ける。
  if (roundTables.length === 0) return { swap: null };

  // 確定後のメンバーで現半荘のランキングを作る（卓順 A→B）。
  const ranked: RankedTable[] = roundTables
    .slice()
    .sort((a, b) => (a.tableLabel ?? "").localeCompare(b.tableLabel ?? ""))
    .map((t) => {
      const members = filledById.get(t.id) ?? t.members;
      return {
        label: t.tableLabel ?? "?",
        ranked: members
          .filter((m) => m.rank != null)
          .map((m) => ({ player: toRotPlayer(m), rank: m.rank as number }))
          .sort((a, b) => a.rank - b.rank),
      };
    });

  const result = computeNextRound(ranked, waitingPool);
  const nextRound = round + 1;
  const tag = day?.demoDummy ? { demoDummy: true } : {};

  const next = db.batch();
  for (const t of result.tables) {
    const members: MahjongTableMember[] = t.members.map((p) => ({
      lineUserId: p.lineUserId,
      displayName: p.displayName,
      pictureUrl: p.pictureUrl ?? "",
      points: null,
      rank: null,
      reportedAt: null,
    }));
    next.set(db.collection("mahjongTables").doc(`tbl-${seasonId}-${eventDate}-r${nextRound}-${t.label}`), {
      seasonId,
      eventDate,
      createdBy: "demo",
      memberIds: t.members.map((p) => p.lineUserId),
      members,
      status: "reporting",
      round: nextRound,
      tableLabel: t.label,
      createdAt: nowIso,
      updatedAt: nowIso,
      ...tag,
    });
  }

  const swap: MahjongDaySwap = {
    round,
    out: result.out.map(toRotPlayer),
    in: result.in.map(toRotPlayer),
    shrunk: result.shrunk,
    reason: result.reason ?? null,
  };
  // 既存フィールド（entryClosedAt/startedBy 等）を引き継ぎつつ次半荘へ。デモは確定済みで見せる。
  next.set(dayRef, {
    ...(day ?? {}),
    seasonId,
    eventDate,
    round: nextRound,
    waiting: result.waiting.map(toRotPlayer),
    tableLabels: result.tables.map((t) => t.label),
    awaitingAssignment: false,
    roundAssignedAt: nowIso,
    roundAssignedBy: "demo",
    lastSwap: swap,
    updatedAt: nowIso,
    ...tag,
  });
  await next.commit();

  return { swap };
}
