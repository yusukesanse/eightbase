/**
 * 【develop 専用 / main へ入れない】検証用ダミー「参加者」データの投入/削除
 * （管理アプリから操作・非本番専用）。
 *
 * 目的: 麻雀の実機確認には人数が必要。管理者が作成した**実シーズン**へ、参加者・順位・
 * 当日卓・CS のダミーを投入して各画面を確認できるようにする。
 *
 * 方針:
 * - シーズンは作らない（管理者が作った seasonId を対象にする）。
 * - 投入する全ドキュメントに `demoDummy: true` を付与し、削除はこのタグのみを対象にする。
 * - **アカウント（authorizedUsers/users）は作らない・消さない**。ログインユーザー（demoユーザー等）は
 *   常に残る。ダミー参加者は卓/参加/順位に埋め込む displayName だけで表現する。
 * - 参加(entries)は「支払い済み(paid)」で入れる（将来の卓自動生成=WP2の対象＝人数確保）。
 */

import { getDb } from "@/lib/firebaseAdmin";
import { tierForRank } from "@/lib/mahjong";
import { buildInitialCsRounds } from "@/lib/mahjongCs";
import { upcomingSaturdayJst } from "@/lib/date";
import { MAHJONG_ENTRY_FEE, MAHJONG_MAX_ENTRIES_PER_DATE, type MahjongCsEntrant, type MahjongTableMember } from "@/types";

const DUMMY_FLAG = { demoDummy: true } as const;

interface P {
  lineUserId: string;
  displayName: string;
}

// ログイン可能な実ユーザー（quick-login と一致）。標準の会員は「demoユーザー」。
const SELF: P = { lineUserId: "dev-member-01", displayName: "demoユーザー" };
const GUEST: P = { lineUserId: "dev-guest-01", displayName: "ゲストテスト" };
const STAFF: P = { lineUserId: "dev-staff-01", displayName: "エイト社員テスト" };

// 埋め込み専用のダミー参加者（アカウントは作らない）。
const DUMMIES: P[] = [
  { lineUserId: "demo-dummy-01", displayName: "佐藤 みなみ" },
  { lineUserId: "demo-dummy-02", displayName: "鈴木 健太" },
  { lineUserId: "demo-dummy-03", displayName: "高橋 あや" },
  { lineUserId: "demo-dummy-04", displayName: "田中 大輔" },
  { lineUserId: "demo-dummy-05", displayName: "渡辺 さくら" },
  { lineUserId: "demo-dummy-06", displayName: "伊藤 悠" },
  { lineUserId: "demo-dummy-07", displayName: "山本 真央" },
  { lineUserId: "demo-dummy-08", displayName: "中村 剛" },
  { lineUserId: "demo-dummy-09", displayName: "小林 花" },
  { lineUserId: "demo-dummy-10", displayName: "加藤 匠" },
  { lineUserId: "demo-dummy-11", displayName: "松本 蓮" },
  { lineUserId: "demo-dummy-12", displayName: "井上 結衣" },
  { lineUserId: "demo-dummy-13", displayName: "木村 拓也" },
  { lineUserId: "demo-dummy-14", displayName: "林 美咲" },
  { lineUserId: "demo-dummy-15", displayName: "清水 陽介" },
  { lineUserId: "demo-dummy-16", displayName: "山口 楓" },
  { lineUserId: "demo-dummy-17", displayName: "森田 隼人" },
];

const POINTS = [40000, 30000, 20000, 10000];

/** JST の YYYY-MM-DD に整形。 */
function completedMembers(group: P[], reportedAt: string): MahjongTableMember[] {
  return group.map((p, i) => ({
    lineUserId: p.lineUserId,
    displayName: p.displayName,
    pictureUrl: "",
    points: POINTS[i],
    rank: i + 1,
    reportedAt,
  }));
}

/**
 * 指定シーズンに検証用ダミーデータを投入する（冪等・固定docID）。
 * @returns 作成件数のサマリ
 */
export async function seedDemoParticipants(seasonId: string): Promise<Record<string, number>> {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  // 開催日は土曜のみ。デモも「直近の土曜」を開催日として全データを土曜に揃える
  //（利用者アプリの参加カレンダー＝土曜のみ・月1回と整合させ、非土曜の不正データを作らない）。
  const today = upcomingSaturdayJst();
  const satMs = new Date(`${today}T00:00:00Z`).getTime();
  const pastDate = new Date(satMs - 14 * 86400000).toISOString().slice(0, 10);
  const futureDate = new Date(satMs + 28 * 86400000).toISOString().slice(0, 10);

  // 0) 対象シーズンをアクティブ化（利用者アプリの参加/申告/支払いがこのシーズンを向くように）。
  //    他の麻雀シーズンは非アクティブ化する（active は1つ）。
  const activeSnap = await db.collection("seasons").where("active", "==", true).get();
  for (const doc of activeSnap.docs) {
    if (doc.id === seasonId) continue;
    const d = doc.data();
    if (d.gameCategory === "mahjong" || !d.gameCategory) {
      await doc.ref.update({ active: false, updatedAt: nowIso });
    }
  }
  //    demoユーザー(SELF)を GM に固定する。demo は SELF で常時ログインして卓を手動振り分けするため、
  //    管理UIでの GM 設定漏れに関係なく、常に SELF が GM＝操作できる状態を保証する。
  await db
    .collection("seasons")
    .doc(seasonId)
    .set({ active: true, gameMasterIds: [SELF.lineUserId], updatedAt: nowIso }, { merge: true });

  // 1) 日程（過去1・当日・未来1）。demoDummy タグ付き。
  const schedule = [
    { id: `demo-sch-${seasonId}-past`, date: pastDate },
    { id: `demo-sch-${seasonId}-today`, date: today },
    { id: `demo-sch-${seasonId}-future`, date: futureDate },
  ];
  for (const s of schedule) {
    await db.collection("mahjongSchedule").doc(s.id).set({
      seasonId,
      date: s.date,
      startTime: "12:00",
      endTime: "18:00",
      type: "league",
      createdAt: nowIso,
      ...DUMMY_FLAG,
    });
  }

  // 2) 完了卓（3卓＝12人）→ computeStandings が順位/M1・M2・M3 を導出。demoユーザーを含めYOU強調。
  const standingPlayers: P[] = [SELF, GUEST, STAFF, ...DUMMIES.slice(0, 9)]; // 12名
  const groups = [standingPlayers.slice(0, 4), standingPlayers.slice(4, 8), standingPlayers.slice(8, 12)];
  let tableCount = 0;
  for (let i = 0; i < groups.length; i++) {
    await db.collection("mahjongTables").doc(`demo-tbl-${seasonId}-c${i + 1}`).set({
      seasonId,
      eventDate: pastDate,
      createdBy: "system",
      memberIds: groups[i].map((p) => p.lineUserId),
      members: completedMembers(groups[i], nowIso),
      status: "completed",
      round: i + 1,
      tableLabel: "A",
      createdAt: nowIso,
      updatedAt: nowIso,
      ...DUMMY_FLAG,
    });
    tableCount++;
  }

  // 3) 当日（GM 手動振り分けデモ）: demoユーザー(SELF)＝GM 兼プレイヤー。卓は作らず、
  //    dayState を「GM 振り分け待ち」(awaitingAssignment=true) で投入する。demoユーザーが
  //    アプリの GM パネルで A/B を手動で振り分けて確定する（＝自動卓確定はしない）。
  //    受付は「ゲーム開始」済み(entryClosedAt) にして、GM が即振り分けられる状態にする。
  //    ダミーは自己申告しないため、申告は「進める」でダミー分を補完 → 次半荘も
  //    awaitingAssignment=true に戻り、GM が改めて振り分ける（下記 4 の paid プールが対象）。
  await db.collection("mahjongDayState").doc(`${seasonId}_${today}`).set({
    seasonId,
    eventDate: today,
    round: 1,
    waiting: [],
    tableLabels: [],
    lastSwap: null,
    awaitingAssignment: true,
    entryClosedAt: nowIso,
    startedBy: SELF.lineUserId,
    updatedAt: nowIso,
    ...DUMMY_FLAG,
  });

  // 4) 当日の参加表明（支払い済み）＝GM が手動振り分けする paid プール。
  //    demoユーザー(SELF＝GM 兼プレイヤー) ＋ ダミー7名 ＝ 8名（先着上限 MAX_ENTRIES_PER_DATE）。
  //    GM はこの8名を A/B に自由に振り分ける（4+4 の2卓、または 4名+4名待機など）。
  //    ※ SELF を必ず paid に含めること。含めないと GM が自分を卓に座らせられない（申告UIに到達しない）。
  let entryCount = 0;
  const paidEntry = async (date: string, p: P) => {
    await db.collection("mahjongEntries").doc(`demo-ent-${seasonId}-${date}-${p.lineUserId}`).set({
      seasonId,
      eventDate: date,
      lineUserId: p.lineUserId,
      displayName: p.displayName,
      pictureUrl: "",
      enteredAt: nowIso,
      paymentStatus: "paid",
      paymentAmount: MAHJONG_ENTRY_FEE,
      paidAt: nowIso,
      ...DUMMY_FLAG,
    });
    entryCount++;
  };
  const todayPool: P[] = [SELF, ...DUMMIES.slice(0, MAHJONG_MAX_ENTRIES_PER_DATE - 1)];
  for (const p of todayPool) await paidEntry(today, p);

  // 5) CS（参戦者＝16名）。卓は必ず4名: 16→準決4卓→決勝1卓(4名)のクリーンなブラケット。
  //    「展開(running)」で投入し、demoユーザーが勝敗入力→次ラウンド→優勝/敗北UIまで確認できる。
  //    順位上位は M1=シード（S バッジ）。demoユーザー(rank1)を含む。
  const csPlayers: P[] = [SELF, GUEST, STAFF, ...DUMMIES.slice(0, 13)]; // 16名
  const entrants: MahjongCsEntrant[] = csPlayers.map((p, i) => ({
    lineUserId: p.lineUserId,
    displayName: p.displayName,
    pictureUrl: "",
    tier: tierForRank(i + 1),
    rank: i + 1,
    seed: tierForRank(i + 1) === "M1",
  }));
  const csRounds = buildInitialCsRounds(entrants);
  await db.collection("mahjongCsEvents").doc(`demo-cs-${seasonId}`).set({
    seasonId,
    name: "検証CS",
    eventDate: futureDate,
    status: csRounds ? "running" : "setup",
    entrants,
    rounds: csRounds ?? [],
    createdAt: nowIso,
    updatedAt: nowIso,
    ...DUMMY_FLAG,
  });

  return {
    schedule: schedule.length,
    tables: tableCount,
    entries: entryCount,
    csEvents: 1,
    players: standingPlayers.length,
  };
}

/**
 * 投入したダミーデータ（demoDummy タグ）だけを削除する。
 * シーズン本体・ログインアカウントには触れない。
 * @returns 削除件数のサマリ
 */
export async function clearDemoParticipants(): Promise<Record<string, number>> {
  const db = getDb();
  const collections = ["mahjongEntries", "mahjongTables", "mahjongSchedule", "mahjongCsEvents", "mahjongDayState"];
  const result: Record<string, number> = {};

  for (const col of collections) {
    const snap = await db.collection(col).where("demoDummy", "==", true).get();
    // バッチ上限(500)を考慮して分割コミット。
    let deleted = 0;
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = db.batch();
      for (const doc of snap.docs.slice(i, i + 400)) batch.delete(doc.ref);
      await batch.commit();
      deleted += Math.min(400, snap.docs.length - i);
    }
    result[col] = deleted;
  }
  return result;
}
