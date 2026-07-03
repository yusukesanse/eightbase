/**
 * 検証用ダミー「参加者」データの投入/削除（管理アプリから操作・非本番専用）。
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
import { MAHJONG_ENTRY_FEE, MAHJONG_MAX_ENTRIES_PER_DATE, type MahjongTableMember } from "@/types";

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
];

const POINTS = [40000, 30000, 20000, 10000];

/** JST の YYYY-MM-DD に整形。 */
function jstDate(ms: number): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date(ms));
}

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

  const today = jstDate(nowMs);
  const pastDate = jstDate(nowMs - 7 * 86400000);
  const futureDate = jstDate(nowMs + 30 * 86400000);

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
  await db.collection("seasons").doc(seasonId).set({ active: true, updatedAt: nowIso }, { merge: true });

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

  // 3) 当日の卓（未申告 reporting）＝申告タブ確認用。demoユーザーを含める（自分の卓として表示）。
  const liveGroup: P[] = [SELF, DUMMIES[0], DUMMIES[1], DUMMIES[2]];
  await db.collection("mahjongTables").doc(`demo-tbl-${seasonId}-live`).set({
    seasonId,
    eventDate: today,
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
    ...DUMMY_FLAG,
  });
  tableCount++;

  // 4) 当日の参加表明（支払い済み）＝人数確保。ゲスト/スタッフでログインして参加・支払いを試せるよう
  //    7名だけ入れ、残り1枠（先着8名）を空ける。
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
  const slots = Math.min(7, MAHJONG_MAX_ENTRIES_PER_DATE - 1);
  for (const p of DUMMIES.slice(0, slots)) await paidEntry(today, p);

  // 5) CS（参戦者一覧＝上位8名）
  const csTop = standingPlayers.slice(0, 8);
  await db.collection("mahjongCsEvents").doc(`demo-cs-${seasonId}`).set({
    seasonId,
    name: "検証CS",
    eventDate: futureDate,
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
  const collections = ["mahjongEntries", "mahjongTables", "mahjongSchedule", "mahjongCsEvents"];
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
