/**
 * 【develop 専用 / main へ入れない】ダーツ検証用ダミーデータの投入（非本番専用）。
 *
 * ダーツの各画面（LEAGUE BOARD＝通算順位/スパークライン・参加タブの当日成績・CS・対戦/申告）を
 * demo で確認できるようにする。麻雀の demoSeed と同方針:
 * - シーズンは作らない（管理者が作った darts seasonId が対象）。対象を active 化＋GMに demoユーザー固定。
 * - 全ドキュメントに `demoDummy: true`。削除はこのタグのみ（アカウントは作らない・消さない）。
 * - 名前は score doc に埋め込む（standings は users join に依存しない）。
 */

import { getDb } from "@/lib/firebaseAdmin";
import { todayJst } from "@/lib/date";
import { buildInitialDartsCsRounds, settleCsRounds } from "@/lib/dartsCs";
import {
  DARTS_ENTRY_FEE,
  DARTS_MAX_ENTRIES_PER_DATE,
  DARTS_DEFAULT_START_TIME,
  DARTS_DEFAULT_END_TIME,
  DARTS_EVENT_ORDER,
  type DartsCsEntrant,
  type DartsEventResult,
  type DartsScoreDetails,
} from "@/types/darts";

const DUMMY_FLAG = { demoDummy: true } as const;

interface P { lineUserId: string; displayName: string }

// ログイン可能な実ユーザー（quick-login と一致）。SELF=demoユーザー（YOU 強調・GM）。
const SELF: P = { lineUserId: "dev-member-01", displayName: "demoユーザー" };
const GUEST: P = { lineUserId: "dev-guest-01", displayName: "ゲストテスト" };
const STAFF: P = { lineUserId: "dev-staff-01", displayName: "エイト社員テスト" };

// 通算順位の並び（上から D1→D2→D3）。SELF を5位(=D2・YOU)に置く。
const RANKED: P[] = [
  { lineUserId: "darts-dummy-01", displayName: "永井 拓人" }, // 1 (D1)
  { lineUserId: "darts-dummy-02", displayName: "上坪 文哉" }, // 2
  { lineUserId: "darts-dummy-03", displayName: "金子 さくら" }, // 3
  { lineUserId: "darts-dummy-04", displayName: "大谷 海斗" }, // 4
  SELF, // 5 (D2・YOU)
  { lineUserId: "darts-dummy-05", displayName: "渡辺 美咲" }, // 6
  { lineUserId: "darts-dummy-06", displayName: "田中 亮" }, // 7
  { lineUserId: "darts-dummy-07", displayName: "小林 さやか" }, // 8
  { lineUserId: "darts-dummy-08", displayName: "山本 拓実" }, // 9 (D3)
  { lineUserId: "darts-dummy-09", displayName: "中村 結衣" }, // 10
  GUEST, // 11 (D3)
  STAFF, // 12 (D3)
];
// CS 用の追加ダミー（16名に増やす）。
const EXTRA: P[] = [
  { lineUserId: "darts-dummy-10", displayName: "森田 隼人" },
  { lineUserId: "darts-dummy-11", displayName: "清水 陽介" },
  { lineUserId: "darts-dummy-12", displayName: "山口 楓" },
  { lineUserId: "darts-dummy-13", displayName: "松本 蓮" },
];

/** 0.5刻みに丸める。 */
const round5 = (v: number) => Math.max(3, Math.round(v * 2) / 2);

/** UTC正午基準で、指定日以前の直近木曜(=4)の YYYY-MM-DD。 */
function thursdayOnOrBefore(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const shift = (d.getUTCDay() - 4 + 7) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}
const addDays = (dateStr: string, days: number) => {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** その日・その選手の1日ptと3種目内訳（表示用・合計が totalScore に一致）。 */
function buildDetails(dayRank: number, totalPt: number): DartsScoreDetails {
  const p1 = round5(totalPt * 0.4);
  const p2 = round5(totalPt * 0.35);
  const p3 = Math.max(0, totalPt - p1 - p2);
  const pts = [p1, p2, p3];
  const values = [90 - dayRank * 8, 600 - dayRank * 30, 95 - dayRank * 6]; // ゼロワン残り/CU合計/クリケットpt（表示用）
  const events: DartsEventResult[] = DARTS_EVENT_ORDER.map((kind, i) => ({
    kind,
    value: Math.max(0, values[i]),
    rank: dayRank,
    points: pts[i],
    ...(kind === "cricket" ? { teamId: `demo-t${Math.ceil(dayRank / 2)}` } : {}),
  }));
  return { events, dayRank, firstCount: dayRank === 1 ? 1 : 0 };
}

/**
 * 指定 darts シーズンに検証用ダミーを投入（冪等・固定docID）。
 */
export async function seedDemoDartsParticipants(seasonId: string): Promise<Record<string, number>> {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const today = todayJst();

  // 0) 対象シーズンを active 化＋GM=demoユーザー。他の darts シーズンは非アクティブ化。
  const activeSnap = await db.collection("seasons").where("active", "==", true).get();
  for (const doc of activeSnap.docs) {
    if (doc.id === seasonId) continue;
    if (doc.data().gameCategory === "darts") await doc.ref.update({ active: false, updatedAt: nowIso });
  }
  await db.collection("seasons").doc(seasonId).set(
    { active: true, gameMasterIds: [SELF.lineUserId], updatedAt: nowIso },
    { merge: true }
  );

  // 1) 開催日: 過去の隔週木曜4日（成績あり）＋当日（GM当日フロー用）＋次回木曜。
  const baseThu = thursdayOnOrBefore(today);
  const pastDates = [addDays(baseThu, -56), addDays(baseThu, -42), addDays(baseThu, -28), addDays(baseThu, -14)];
  const futureThu = addDays(baseThu, 14);
  const scheduleDates = [...pastDates, today, futureThu];
  let scheduleCount = 0;
  for (const date of scheduleDates) {
    await db.collection("dartsSchedule").doc(`${seasonId}_${date}`).set({
      scheduleId: `${seasonId}_${date}`,
      seasonId,
      date,
      startTime: DARTS_DEFAULT_START_TIME,
      endTime: DARTS_DEFAULT_END_TIME,
      createdAt: nowIso,
      ...DUMMY_FLAG,
    });
    scheduleCount++;
  }

  // 2) 過去4開催日の成績を scores へ（通算順位/スパークライン/当日成績の元）。名前を埋め込む。
  //    選手 p の1日pt = base(順位で降順) + 決定的ノイズ。日ごとに dayRank を再計算。
  const base = RANKED.map((_, i) => 21 - i * 1.4);
  let scoreCount = 0;
  for (let di = 0; di < pastDates.length; di++) {
    const date = pastDates[di];
    const gameId = `darts-${seasonId}-${date}`;
    // その日の pt を全員分算出 → dayRank。
    const dayPts = RANKED.map((_, i) => round5(base[i] + Math.sin((i + 1) * (di + 2)) * 2.2));
    const order = RANKED.map((_, i) => i).sort((a, b) => dayPts[b] - dayPts[a]);
    const dayRankOf = new Map<number, number>();
    order.forEach((idx, r) => dayRankOf.set(idx, r + 1));

    // games doc（軽量・整合用）。
    await db.collection("games").doc(gameId).set({
      gameId, gameCategory: "darts", seasonId, eventDate: date,
      title: `ダーツリーグ ${date}`, startAt: date, scoreRegistered: true, updatedAt: nowIso, ...DUMMY_FLAG,
    }, { merge: true });

    for (let i = 0; i < RANKED.length; i++) {
      const p = RANKED[i];
      const dayRank = dayRankOf.get(i) ?? i + 1;
      const totalPt = dayPts[i];
      await db.collection("scores").doc(`${gameId}-${p.lineUserId}`).set({
        gameId, gameCategory: "darts", lineUserId: p.lineUserId,
        displayName: p.displayName, pictureUrl: "",
        seasonId, yearMonth: date.slice(0, 7),
        totalScore: totalPt, details: buildDetails(dayRank, totalPt),
        playedAt: date, recordedBy: "demo", createdAt: nowIso, ...DUMMY_FLAG,
      }, { merge: true });
      scoreCount++;
    }
  }

  // 3) 当日の参加表明（支払い済み8名）＝GM が当日フローを回せる paid プール。SELF を必ず含める。
  const todayPool: P[] = [SELF, ...RANKED.filter((p) => p.lineUserId !== SELF.lineUserId).slice(0, DARTS_MAX_ENTRIES_PER_DATE - 1)];
  let entryCount = 0;
  for (const p of todayPool) {
    await db.collection("dartsEntries").doc(`${seasonId}_${today}_${p.lineUserId}`).set({
      seasonId, eventDate: today, lineUserId: p.lineUserId, displayName: p.displayName, pictureUrl: "",
      enteredAt: nowIso, status: "paid", paymentStatus: "paid", paymentAmount: DARTS_ENTRY_FEE, paidAt: nowIso, ...DUMMY_FLAG,
    });
    entryCount++;
  }
  // 当日フローは未開始で入れる（GM が「ゲーム開始」から通しで体験）。既存の dayState は消してリセット。
  await db.collection("dartsDayState").doc(`${seasonId}_${today}`).delete().catch(() => {});

  // 4) CS（16名・running）。上位4名シード。demoユーザーを含む。
  const csPlayers: P[] = [...RANKED, ...EXTRA].slice(0, 16);
  const entrants: DartsCsEntrant[] = csPlayers.map((p, i) => ({
    lineUserId: p.lineUserId, displayName: p.displayName, pictureUrl: "", rank: i + 1, seed: i < 4,
  }));
  const rounds = buildInitialDartsCsRounds(entrants);
  await db.collection("dartsCsEvents").doc(`demo-darts-cs-${seasonId}`).set({
    seasonId, name: "検証ダーツCS", eventDate: pastDates[pastDates.length - 1],
    status: rounds ? "running" : "setup", entrants, rounds: rounds ? settleCsRounds(rounds) : [],
    championId: null, createdAt: nowIso, updatedAt: nowIso, ...DUMMY_FLAG,
  });

  return { schedule: scheduleCount, scores: scoreCount, entries: entryCount, csEvents: 1, players: RANKED.length };
}
