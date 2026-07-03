/**
 * 【develop 専用 / main へ入れない】検証環境（demo/非本番）向けの麻雀ゲームデータ投入。
 *
 * **実データを Firestore に書く**ので、
 * quick-login の実ユーザー（管理画面にも表示）と共存したまま、リーグ/順位/申告/CS を確認できる。
 * - 固定 doc ID で set() する＝**冪等**（何度押しても重複しない）。
 * - `dev-member-01` / `dev-guest-01`（quick-login の固定ユーザー）を含めるので「自分」ハイライトも一致。
 * - 非本番専用（呼び出し側 `/api/dev/seed` が isDevLoginEnabled() でガード）。
 */

import { getDb } from "@/lib/firebaseAdmin";
import { tierForRank } from "@/lib/mahjong";
import { MAHJONG_MAX_ENTRIES_PER_DATE, type MahjongTableMember } from "@/types";

const SEASON_ID = "dev-mh-season";
const PAST_DATE = "2026-06-13";
const UPCOMING_DATE = "2026-07-11";

interface P {
  lineUserId: string;
  displayName: string;
}
const PLAYERS: P[] = [
  { lineUserId: "dev-member-01", displayName: "demoユーザー" },
  { lineUserId: "dev-guest-01", displayName: "ゲストテスト" },
  { lineUserId: "dev-u3", displayName: "佐藤 みなみ" },
  { lineUserId: "dev-u4", displayName: "鈴木 健太" },
  { lineUserId: "dev-u5", displayName: "高橋 あや" },
  { lineUserId: "dev-u6", displayName: "田中 大輔" },
  { lineUserId: "dev-u7", displayName: "渡辺 さくら" },
  { lineUserId: "dev-u8", displayName: "伊藤 悠" },
  { lineUserId: "dev-u9", displayName: "山本 真央" },
  { lineUserId: "dev-u10", displayName: "中村 剛" },
  { lineUserId: "dev-u11", displayName: "小林 花" },
  { lineUserId: "dev-u12", displayName: "加藤 匠" },
];

const POINTS = [40000, 30000, 20000, 10000];

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
 * demo に麻雀の検証データ（シーズン・日程・完了卓・当日卓・参加・CS）を投入する。
 * @returns 作成件数のサマリ
 */
export async function seedDemoMahjong(): Promise<Record<string, number>> {
  const db = getDb();
  const nowIso = new Date().toISOString();

  // 0) 既存のアクティブ麻雀シーズンを非アクティブ化（getActiveSeason が本シーズンを返すように）
  const activeSnap = await db.collection("seasons").where("active", "==", true).get();
  let deactivated = 0;
  for (const doc of activeSnap.docs) {
    if (doc.id === SEASON_ID) continue;
    const d = doc.data();
    if (d.gameCategory === "mahjong" || !d.gameCategory) {
      await doc.ref.update({ active: false, updatedAt: nowIso });
      deactivated++;
    }
  }

  // 1) シーズン
  await db.collection("seasons").doc(SEASON_ID).set({
    name: "検証シーズン（麻雀）",
    gameCategory: "mahjong",
    startDate: "2026-06-01",
    endDate: "2027-05-31",
    active: true,
    csConfig: { mahjong: { topN: 8 } },
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  // 2) 日程（過去1・今後2）
  const schedule = [
    { id: "dev-sch-past", date: PAST_DATE },
    { id: "dev-sch-1", date: UPCOMING_DATE },
    { id: "dev-sch-2", date: "2026-08-08" },
  ];
  for (const s of schedule) {
    await db.collection("mahjongSchedule").doc(s.id).set({
      seasonId: SEASON_ID,
      date: s.date,
      startTime: "12:00",
      endTime: "18:00",
      type: "league",
      createdAt: nowIso,
    });
  }

  // 3) 完了卓（3卓＝12人）→ computeStandings が順位・M1/M2/M3 を導出
  const groups = [PLAYERS.slice(0, 4), PLAYERS.slice(4, 8), PLAYERS.slice(8, 12)];
  let tableCount = 0;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    await db.collection("mahjongTables").doc(`dev-tbl-c${i + 1}`).set({
      seasonId: SEASON_ID,
      eventDate: PAST_DATE,
      createdBy: "system",
      memberIds: g.map((p) => p.lineUserId),
      members: completedMembers(g, nowIso),
      status: "completed",
      round: i + 1,
      tableLabel: "A",
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    tableCount++;
  }

  // 4) 当日の卓（未申告 reporting）＝申告タブ確認用。会員/ゲスト/エイト社員を含める。
  const liveGroup: P[] = [
    PLAYERS[0], // 会員テスト
    PLAYERS[1], // ゲストテスト
    { lineUserId: "dev-staff-01", displayName: "エイト社員テスト" },
    PLAYERS[2],
  ];
  await db.collection("mahjongTables").doc("dev-tbl-live").set({
    seasonId: SEASON_ID,
    eventDate: UPCOMING_DATE,
    createdBy: "system",
    memberIds: liveGroup.map((p) => p.lineUserId),
    members: liveGroup.map((p) => ({
      lineUserId: p.lineUserId,
      displayName: p.displayName,
      pictureUrl: "",
      points: null,
      rank: null,
      reportedAt: null,
    })),
    status: "reporting",
    round: 1,
    tableLabel: "A",
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  tableCount++;

  // 5) 参加表明
  let entryCount = 0;
  const addEntry = async (date: string, p: P) => {
    await db.collection("mahjongEntries").doc(`dev-ent-${date}-${p.lineUserId}`).set({
      seasonId: SEASON_ID,
      eventDate: date,
      lineUserId: p.lineUserId,
      displayName: p.displayName,
      pictureUrl: "",
      enteredAt: nowIso,
    });
    entryCount++;
  };
  // (a) 今後の開催日(UPCOMING)に会員/ゲストが参加中＝「参加中」表示の確認用
  for (const p of [PLAYERS[0], PLAYERS[1]]) await addEntry(UPCOMING_DATE, p);
  // (b) 別の開催日(FULL_DATE)を先着8名で満員に＝「満員・参加ボタン非活性」の確認用
  //     テストログインユーザー(member/guest/staff)は含めないので、ログイン時に満員表示になる
  const FULL_DATE = "2026-08-08";
  for (const p of PLAYERS.slice(2, 2 + MAHJONG_MAX_ENTRIES_PER_DATE)) await addEntry(FULL_DATE, p);

  // 6) CS（参戦者一覧＝上位8名。ブラケットは entry フェーズ）
  const csTop = [PLAYERS[0], PLAYERS[1], PLAYERS[2], PLAYERS[8], PLAYERS[5], PLAYERS[9], PLAYERS[3], PLAYERS[6]];
  await db.collection("mahjongCsEvents").doc("dev-cs-1").set({
    seasonId: SEASON_ID,
    name: "検証CS",
    eventDate: "2026-09-05",
    status: "setup",
    entrants: csTop.map((p, i) => ({
      lineUserId: p.lineUserId,
      displayName: p.displayName,
      pictureUrl: "",
      tier: tierForRank(i + 1),
      rank: i + 1,
      seed: i === 0,
    })),
    rounds: [],
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  return {
    seasonsDeactivated: deactivated,
    schedule: schedule.length,
    tables: tableCount,
    entries: entryCount,
    csEvents: 1,
    players: PLAYERS.length,
  };
}
