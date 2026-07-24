/**
 * 【develop 専用 / main へ入れない】ポーカー検証用ダミーデータの投入（非本番専用）。
 *
 * ポーカーの各画面（LEAGUE BOARD＝通算チップ順・tier・スパークライン・参加タブの当日成績・
 * 当日フロー[ディーラー主導の複数試合]）を demo で確認できるようにする。
 * ダーツ/ビリヤードの DemoSeed と同方針:
 * - シーズンは作らない（管理者が作った poker seasonId が対象）。対象を active 化。
 *   **ポーカーはシーズンGMを置かない（ディーラー主導）ので gameMasterIds は設定しない。**
 * - 全ドキュメントに `demoDummy: true`。削除はこのタグのみ（アカウントは作らない・消さない）。
 * - 名前は score doc に埋め込む（standings は users join に依存しない）。
 * - 当日フローは未開始で入れる（誰かが「ディーラーをやる→ゲーム開始→…→確定」を通しで体験）。CS は未実装。
 */

import { getDb } from "@/lib/firebaseAdmin";
import { todayJst } from "@/lib/date";
import { buildPokerScheduleId, buildPokerEntryId } from "@/lib/pokerEntryValidation";
import {
  POKER_ENTRY_FEE,
  POKER_DEFAULT_START_TIME,
  POKER_DEFAULT_END_TIME,
  type PokerScoreDetails,
} from "@/types/poker";

const DUMMY_FLAG = { demoDummy: true } as const;

interface P { lineUserId: string; displayName: string }

// ログイン可能な実ユーザー（quick-login と一致）。SELF=demoユーザー（YOU 強調）。
const SELF: P = { lineUserId: "dev-member-01", displayName: "demoユーザー" };
const GUEST: P = { lineUserId: "dev-guest-01", displayName: "ゲストテスト" };
const STAFF: P = { lineUserId: "dev-staff-01", displayName: "エイト社員テスト" };

// 通算順位の並び（上から P1→P2→P3）。SELF を5位(=P2・YOU)に置く。
const RANKED: P[] = [
  { lineUserId: "poker-dummy-01", displayName: "永井 拓人" }, // 1 (P1)
  { lineUserId: "poker-dummy-02", displayName: "上坪 文哉" }, // 2
  { lineUserId: "poker-dummy-03", displayName: "金子 さくら" }, // 3
  { lineUserId: "poker-dummy-04", displayName: "大谷 海斗" }, // 4
  SELF, // 5 (P2・YOU)
  { lineUserId: "poker-dummy-05", displayName: "渡辺 美咲" }, // 6
  { lineUserId: "poker-dummy-06", displayName: "田中 亮" }, // 7
  { lineUserId: "poker-dummy-07", displayName: "小林 さやか" }, // 8
  { lineUserId: "poker-dummy-08", displayName: "山本 拓実" }, // 9 (P3)
  { lineUserId: "poker-dummy-09", displayName: "中村 結衣" }, // 10
  GUEST, // 11 (P3)
  STAFF, // 12 (P3)
];

/** UTC正午基準で、指定日以前の直近土曜(=6)の YYYY-MM-DD。 */
function saturdayOnOrBefore(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const shift = (d.getUTCDay() - 6 + 7) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}
const addDays = (dateStr: string, days: number) => {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** その日・その選手の当日チップ合計から表示用の内訳（2試合分）を作る（合計が totalChips に一致）。 */
function buildPokerDetails(dayRank: number, totalChips: number, idx: number): PokerScoreDetails {
  const g1 = Math.round(totalChips * 0.55);
  const g2 = totalChips - g1;
  const games = [
    { gameIndex: 1, chips: g1, rank: (idx % 5) + 1 },
    { gameIndex: 2, chips: g2, rank: ((idx + 2) % 5) + 1 },
  ];
  return { games, totalChips, gamesPlayed: 2, dayRank, chipCount: totalChips, tournamentRank: dayRank };
}

/**
 * 指定 poker シーズンに検証用ダミーを投入（冪等・固定docID）。
 */
export async function seedDemoPokerParticipants(seasonId: string): Promise<Record<string, number>> {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const today = todayJst();

  // 0) 対象シーズンを active 化（他の poker シーズンは非アクティブ化）。GM は設定しない（ディーラー主導）。
  const activeSnap = await db.collection("seasons").where("active", "==", true).get();
  for (const doc of activeSnap.docs) {
    if (doc.id === seasonId) continue;
    if (doc.data().gameCategory === "poker") await doc.ref.update({ active: false, updatedAt: nowIso });
  }
  await db.collection("seasons").doc(seasonId).set({ active: true, updatedAt: nowIso }, { merge: true });

  // 1) 開催日: 過去の隔週土曜4日（成績あり）＋当日（当日フロー用）＋次回土曜。
  const baseSat = saturdayOnOrBefore(today);
  const pastDates = [addDays(baseSat, -56), addDays(baseSat, -42), addDays(baseSat, -28), addDays(baseSat, -14)];
  const futureSat = addDays(baseSat, 14);
  const scheduleDates = [...pastDates, today, futureSat];
  let scheduleCount = 0;
  for (const date of scheduleDates) {
    await db.collection("pokerSchedule").doc(buildPokerScheduleId(seasonId, date)).set({
      scheduleId: buildPokerScheduleId(seasonId, date),
      seasonId,
      date,
      startTime: POKER_DEFAULT_START_TIME,
      endTime: POKER_DEFAULT_END_TIME,
      createdAt: nowIso,
      ...DUMMY_FLAG,
    });
    scheduleCount++;
  }

  // 2) 過去4開催日の成績を scores へ（通算チップ/スパークライン/当日成績の元）。名前を埋め込む。
  const base = RANKED.map((_, i) => 22000 - i * 1500); // 22000,20500,...（rank降順のチップ）
  let scoreCount = 0;
  for (let di = 0; di < pastDates.length; di++) {
    const date = pastDates[di];
    const gameId = `poker-${seasonId}-${date}`;
    const dayChips = RANKED.map((_, i) => Math.max(0, Math.round(base[i] + Math.sin((i + 1) * (di + 2)) * 2500)));
    const order = RANKED.map((_, i) => i).sort((a, b) => dayChips[b] - dayChips[a]);
    const dayRankOf = new Map<number, number>();
    order.forEach((idx, r) => dayRankOf.set(idx, r + 1));

    await db.collection("games").doc(gameId).set({
      gameId, gameCategory: "poker", seasonId, eventDate: date,
      title: `ポーカーリーグ ${date}`, startAt: date, scoreRegistered: true, updatedAt: nowIso, ...DUMMY_FLAG,
    }, { merge: true });

    for (let i = 0; i < RANKED.length; i++) {
      const p = RANKED[i];
      const dayRank = dayRankOf.get(i) ?? i + 1;
      const totalChips = dayChips[i];
      await db.collection("scores").doc(`${gameId}-${p.lineUserId}`).set({
        gameId, gameCategory: "poker", lineUserId: p.lineUserId,
        displayName: p.displayName, pictureUrl: "",
        seasonId, yearMonth: date.slice(0, 7),
        totalScore: totalChips, details: buildPokerDetails(dayRank, totalChips, i),
        playedAt: date, recordedBy: "demo", createdAt: nowIso, ...DUMMY_FLAG,
      }, { merge: true });
      scoreCount++;
    }
  }

  // 3) 当日の参加表明（支払い済み6名）＝ディーラー主導フローを回せる paid プール。SELF を必ず含める。
  const todayPool: P[] = [SELF, ...RANKED.filter((p) => p.lineUserId !== SELF.lineUserId).slice(0, 5)];
  let entryCount = 0;
  for (const p of todayPool) {
    await db.collection("pokerEntries").doc(buildPokerEntryId(seasonId, today, p.lineUserId)).set({
      seasonId, eventDate: today, lineUserId: p.lineUserId, displayName: p.displayName, pictureUrl: "",
      enteredAt: nowIso, status: "paid", paymentStatus: "paid", paymentAmount: POKER_ENTRY_FEE, paidAt: nowIso, ...DUMMY_FLAG,
    });
    entryCount++;
  }
  // 当日フローは未開始で入れる（誰かが「ディーラーをやる→ゲーム開始」から通しで体験）。既存 dayState はリセット。
  await db.collection("pokerDayState").doc(`${seasonId}_${today}`).delete().catch(() => {});

  return { schedule: scheduleCount, scores: scoreCount, entries: entryCount, players: RANKED.length };
}
