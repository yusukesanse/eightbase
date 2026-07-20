/**
 * 【develop 専用 / main へ入れない】ビリヤード検証用ダミーデータの投入（非本番専用）。
 *
 * ビリヤードの各画面（LEAGUE BOARD＝ティア横並び/通算順位・詳細リストのスパークライン・
 * 参加タブの当日成績・CS・対戦記録[GM当日フロー]）を demo で確認できるようにする。
 * ダーツの dartsDemoSeed と同方針:
 * - シーズンは作らない（管理者が作った billiards seasonId が対象）。対象を active 化＋GMに demoユーザー固定。
 * - 全ドキュメントに `demoDummy: true`。削除はこのタグのみ（アカウントは作らない・消さない）。
 * - 名前は score doc に埋め込む（standings は users join に依存しない）。
 * - 当日フローは未開始で入れる（GM が「ゲーム開始→試合記録→本日終了」を通しで体験）。
 */

import { getDb } from "@/lib/firebaseAdmin";
import { todayJst } from "@/lib/date";
import { buildInitialBilliardsCsRounds, settleCsRounds } from "@/lib/billiardsCs";
import { buildBilliardsScheduleId, buildBilliardsEntryId } from "@/lib/billiardsEntryValidation";
import {
  BILLIARDS_ENTRY_FEE,
  BILLIARDS_MAX_ENTRIES_PER_DATE,
  BILLIARDS_DEFAULT_START_TIME,
  BILLIARDS_DEFAULT_END_TIME,
  BILLIARDS_WINNER_POINTS,
  type BilliardsCsEntrant,
  type BilliardsScoreDetails,
  type BilliardsMatchResult,
} from "@/types/billiards";

const DUMMY_FLAG = { demoDummy: true } as const;

interface P { lineUserId: string; displayName: string }

// ログイン可能な実ユーザー（quick-login と一致）。SELF=demoユーザー（YOU 強調・GM）。
const SELF: P = { lineUserId: "dev-member-01", displayName: "demoユーザー" };
const GUEST: P = { lineUserId: "dev-guest-01", displayName: "ゲストテスト" };
const STAFF: P = { lineUserId: "dev-staff-01", displayName: "エイト社員テスト" };

// 通算順位の並び（上から B1→B2→B3）。SELF を5位(=B2・YOU)に置く。
const RANKED: P[] = [
  { lineUserId: "billiards-dummy-01", displayName: "永井 拓人" }, // 1 (B1)
  { lineUserId: "billiards-dummy-02", displayName: "上坪 文哉" }, // 2
  { lineUserId: "billiards-dummy-03", displayName: "金子 さくら" }, // 3
  { lineUserId: "billiards-dummy-04", displayName: "大谷 海斗" }, // 4
  SELF, // 5 (B2・YOU)
  { lineUserId: "billiards-dummy-05", displayName: "渡辺 美咲" }, // 6
  { lineUserId: "billiards-dummy-06", displayName: "田中 亮" }, // 7
  { lineUserId: "billiards-dummy-07", displayName: "小林 さやか" }, // 8
  { lineUserId: "billiards-dummy-08", displayName: "山本 拓実" }, // 9 (B3)
  { lineUserId: "billiards-dummy-09", displayName: "中村 結衣" }, // 10
  GUEST, // 11 (B3)
  STAFF, // 12 (B3)
];
// CS 用の追加ダミー（16名に増やす）。
const EXTRA: P[] = [
  { lineUserId: "billiards-dummy-10", displayName: "森田 隼人" },
  { lineUserId: "billiards-dummy-11", displayName: "清水 陽介" },
  { lineUserId: "billiards-dummy-12", displayName: "山口 楓" },
  { lineUserId: "billiards-dummy-13", displayName: "松本 蓮" },
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

const OPP = ["永井", "上坪", "金子", "渡辺", "田中", "小林", "山本", "中村"];

/**
 * その日・その選手の当日点(totalScore)から表示用の内訳を作る（合計が totalScore に一致）。
 * 勝ち=14pt を積み、端数は敗け(落とした玉数)で表現。realism 用に 0pt の敗けを1つ足す（合計不変）。
 */
function buildDetails(dayRank: number, totalScore: number, idx: number): BilliardsScoreDetails {
  const wins = Math.floor(totalScore / BILLIARDS_WINNER_POINTS);
  const matches: BilliardsMatchResult[] = [];
  for (let w = 0; w < wins; w++) matches.push({ result: "win", points: BILLIARDS_WINNER_POINTS, opponentName: OPP[(idx + w) % OPP.length] });
  let rem = totalScore - wins * BILLIARDS_WINNER_POINTS;
  let k = 0;
  while (rem > 0) {
    const b = Math.min(7, rem);
    matches.push({ result: "lose", points: b, opponentName: OPP[(idx + wins + k) % OPP.length] });
    rem -= b; k++;
  }
  if (wins > 0) matches.push({ result: "lose", points: 0, opponentName: OPP[(idx + 3) % OPP.length] }); // 0pt敗け（合計不変）
  const losses = matches.filter((m) => m.result === "lose").length;
  return { matches, wins, losses, dayRank };
}

/**
 * 指定 billiards シーズンに検証用ダミーを投入（冪等・固定docID）。
 */
export async function seedDemoBilliardsParticipants(seasonId: string): Promise<Record<string, number>> {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const today = todayJst();

  // 0) 対象シーズンを active 化＋GM=demoユーザー。他の billiards シーズンは非アクティブ化。
  const activeSnap = await db.collection("seasons").where("active", "==", true).get();
  for (const doc of activeSnap.docs) {
    if (doc.id === seasonId) continue;
    if (doc.data().gameCategory === "billiards") await doc.ref.update({ active: false, updatedAt: nowIso });
  }
  await db.collection("seasons").doc(seasonId).set(
    { active: true, gameMasterIds: [SELF.lineUserId], updatedAt: nowIso },
    { merge: true }
  );

  // 1) 開催日: 過去の隔週土曜4日（成績あり）＋当日（GM当日フロー用）＋次回土曜。
  const baseSat = saturdayOnOrBefore(today);
  const pastDates = [addDays(baseSat, -56), addDays(baseSat, -42), addDays(baseSat, -28), addDays(baseSat, -14)];
  const futureSat = addDays(baseSat, 14);
  const scheduleDates = [...pastDates, today, futureSat];
  let scheduleCount = 0;
  for (const date of scheduleDates) {
    await db.collection("billiardsSchedule").doc(buildBilliardsScheduleId(seasonId, date)).set({
      scheduleId: buildBilliardsScheduleId(seasonId, date),
      seasonId,
      date,
      startTime: BILLIARDS_DEFAULT_START_TIME,
      endTime: BILLIARDS_DEFAULT_END_TIME,
      createdAt: nowIso,
      ...DUMMY_FLAG,
    });
    scheduleCount++;
  }

  // 2) 過去4開催日の成績を scores へ（通算順位/スパークライン/当日成績の元）。名前を埋め込む。
  //    選手 p の当日点 = base(順位で降順) + 決定的ノイズ。日ごとに dayRank を再計算。
  const base = RANKED.map((_, i) => 44 - i * 3); // 44,41,...（14刻みの勝ち＋端数に丸める）
  let scoreCount = 0;
  for (let di = 0; di < pastDates.length; di++) {
    const date = pastDates[di];
    const gameId = `billiards-${seasonId}-${date}`;
    const dayPts = RANKED.map((_, i) => Math.max(0, Math.round(base[i] + Math.sin((i + 1) * (di + 2)) * 4)));
    const order = RANKED.map((_, i) => i).sort((a, b) => dayPts[b] - dayPts[a]);
    const dayRankOf = new Map<number, number>();
    order.forEach((idx, r) => dayRankOf.set(idx, r + 1));

    await db.collection("games").doc(gameId).set({
      gameId, gameCategory: "billiards", seasonId, eventDate: date,
      title: `ビリヤードリーグ ${date}`, startAt: date, scoreRegistered: true, updatedAt: nowIso, ...DUMMY_FLAG,
    }, { merge: true });

    for (let i = 0; i < RANKED.length; i++) {
      const p = RANKED[i];
      const dayRank = dayRankOf.get(i) ?? i + 1;
      const totalScore = dayPts[i];
      await db.collection("scores").doc(`${gameId}-${p.lineUserId}`).set({
        gameId, gameCategory: "billiards", lineUserId: p.lineUserId,
        displayName: p.displayName, pictureUrl: "",
        seasonId, yearMonth: date.slice(0, 7),
        totalScore, details: buildDetails(dayRank, totalScore, i),
        playedAt: date, recordedBy: "demo", createdAt: nowIso, ...DUMMY_FLAG,
      }, { merge: true });
      scoreCount++;
    }
  }

  // 3) 当日の参加表明（支払い済み8名）＝GM が当日フローを回せる paid プール。SELF を必ず含める。
  const todayPool: P[] = [SELF, ...RANKED.filter((p) => p.lineUserId !== SELF.lineUserId).slice(0, BILLIARDS_MAX_ENTRIES_PER_DATE - 1)];
  let entryCount = 0;
  for (const p of todayPool) {
    await db.collection("billiardsEntries").doc(buildBilliardsEntryId(seasonId, today, p.lineUserId)).set({
      seasonId, eventDate: today, lineUserId: p.lineUserId, displayName: p.displayName, pictureUrl: "",
      enteredAt: nowIso, status: "paid", paymentStatus: "paid", paymentAmount: BILLIARDS_ENTRY_FEE, paidAt: nowIso, ...DUMMY_FLAG,
    });
    entryCount++;
  }
  // 当日フローは未開始で入れる（GM が「ゲーム開始」から通しで体験）。既存の dayState は消してリセット。
  await db.collection("billiardsDayState").doc(`${seasonId}_${today}`).delete().catch(() => {});

  // 4) CS（16名・running）。上位4名シード。demoユーザーを含む。
  const csPlayers: P[] = [...RANKED, ...EXTRA].slice(0, 16);
  const entrants: BilliardsCsEntrant[] = csPlayers.map((p, i) => ({
    lineUserId: p.lineUserId, displayName: p.displayName, pictureUrl: "", rank: i + 1, seed: i < 4,
  }));
  const rounds = buildInitialBilliardsCsRounds(entrants);
  await db.collection("billiardsCsEvents").doc(`demo-billiards-cs-${seasonId}`).set({
    seasonId, name: "検証ビリヤードCS", eventDate: pastDates[pastDates.length - 1],
    status: rounds ? "running" : "setup", entrants, rounds: rounds ? settleCsRounds(rounds) : [],
    championId: null, runnerUpId: null, thirdId: null, createdAt: nowIso, updatedAt: nowIso, ...DUMMY_FLAG,
  });

  return { schedule: scheduleCount, scores: scoreCount, entries: entryCount, csEvents: 1, players: RANKED.length };
}
