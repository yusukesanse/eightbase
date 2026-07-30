/**
 * 【develop 専用 / main へ入れない】demo 環境を**アプリ全体で**一括に整えるシード。
 *
 * 背景: 投入ツールが「ゲーム単位」「サウナ単位」でバラバラだったため、
 * demo で通しの動作確認をしようとすると画面ごとにデータが欠けていて確認しづらかった
 * （三瀬さんの指摘・2026-07-30）。**1つの入口で全画面ぶんのデータが揃う**ようにする。
 *
 * 方針:
 * - 施設は**既存の固定ID**（`meetingroom-a` 等＝`FALLBACK_FACILITIES` と同じID）に set する。
 *   新しいIDを作らないので、既に demo にある施設と**二重にならない**（冪等）。
 * - 投入する doc には `demoDummy: true` を付け、削除はこのタグのみを対象にする。
 *   ただし施設は固定IDなので、削除対象は「タグ付き かつ demo- 始まりのID」に限る
 *   （標準施設を消して demo を壊さない）。
 * - ゲーム4種目はシーズンを作ってから既存の種目別シードに委譲する（重複実装しない）。
 * - サウナは `saunaDemoSeed` に委譲する（同伴者候補のアカウント作成を含むため）。
 *
 * ⚠️ 予約そのものは**ほとんど作らない**。予約は利用者アプリで実際に取って確認するものなので、
 *    シードで作ると「アプリの予約フローを通していない」状態になる。
 *    例外はサウナの「自分が同伴者」の1件だけ（ダミーはログインできず手作業で作れないため）。
 */

import { getDb } from "@/lib/firebaseAdmin";
import { todayJst, addDaysJst } from "@/lib/date";
import { seedSaunaDemo, clearSaunaDemo } from "@/dev-only/saunaDemoSeed";
import { seedDemoParticipants } from "@/dev-only/demoSeed";
import { seedDemoDartsParticipants } from "@/dev-only/dartsDemoSeed";
import { seedDemoBilliardsParticipants } from "@/dev-only/billiardsDemoSeed";
import { seedDemoPokerParticipants } from "@/dev-only/pokerDemoSeed";
import type { ScoreboardGameId } from "@/types";

const DUMMY_FLAG = { demoDummy: true } as const;

/** demo 用に作る施設のID接頭辞。削除対象の判定に使う（標準施設は消さない）。 */
const DEMO_FACILITY_PREFIX = "demo-";

/** トレーラー（Square決済＋SwitchBot解錠）の検証用施設。 */
const TRAILER_ID = "demo-trailer";

/** キーパッドの deviceId（パスコードを扱うのはキーパッド。ロックではない）。 */
const KEYPAD_DEVICE_ID = "CED6749F1F5A";

/**
 * 短い利用規約。
 * ⚠️ **わざと短くしている。** 規約が短くてスクロールが発生しない施設で
 * 「同意ボタンが出ず予約できない」不具合があったため、その再発を demo で踏めるようにする。
 */
const SHORT_TERMS = `## ご利用にあたって

- 時間厳守でご利用ください。
- 退出時は忘れ物のないようご確認ください。
- 設備の破損は速やかにご連絡ください。`;

const LONG_TERMS = `## 利用規約

### 第1条（目的）
本規約は、当施設の利用に関する条件を定めるものです。

### 第2条（予約）
1. 予約はアプリを通じて行うものとします。
2. 予約の変更・取消は利用開始時刻までに行ってください。

### 第3条（料金）
所定の料金をお支払いいただきます。決済完了をもって予約確定とします。

### 第4条（禁止事項）
1. 施設内での喫煙、火気の使用
2. 他の利用者の迷惑となる行為
3. 設備の無断持ち出し

### 第5条（免責）
利用者の責めに帰すべき事由による損害について、当社は責任を負いません。

### 第6条（解錠コード）
解錠コードは予約者本人のみが使用できます。第三者への譲渡・共有を禁じます。

### 第7条（規約の変更）
本規約は予告なく変更されることがあります。`;

interface FacilitySeed {
  id: string;
  name: string;
  type: "meeting_room" | "booth" | "activity";
  capacity: number;
  openTime: string;
  closeTime: string;
  availableDays: number[];
  minDuration?: number;
  fixedDuration?: boolean;
  requireTerms?: boolean;
  termsContent?: string;
  paymentAmount?: number;
  switchBotDeviceId?: string;
  minAdvanceDays?: number;
  order: number;
}

/**
 * 標準施設。**IDは FALLBACK_FACILITIES と同じ**にして二重登録を避ける。
 * calendarId は既存値を壊さないよう、既にあれば引き継ぐ（下の upsert 参照）。
 */
const STANDARD_FACILITIES: FacilitySeed[] = [
  { id: "meetingroom-a", name: "会議室 A", type: "meeting_room", capacity: 6, openTime: "09:00", closeTime: "18:00", availableDays: [1, 2, 3, 4, 5], order: 1 },
  { id: "meetingroom-b", name: "会議室 B", type: "meeting_room", capacity: 4, openTime: "09:00", closeTime: "18:00", availableDays: [1, 2, 3, 4, 5], order: 2 },
  { id: "meetingroom-c", name: "会議室 C", type: "meeting_room", capacity: 8, openTime: "09:00", closeTime: "18:00", availableDays: [1, 2, 3, 4, 5], requireTerms: true, termsContent: SHORT_TERMS, order: 3 },
  { id: "booth-1", name: "ブース 1", type: "booth", capacity: 1, openTime: "09:00", closeTime: "20:00", availableDays: [1, 2, 3, 4, 5, 6], order: 4 },
  { id: "booth-2", name: "ブース 2", type: "booth", capacity: 1, openTime: "09:00", closeTime: "20:00", availableDays: [1, 2, 3, 4, 5, 6], order: 5 },
  { id: "booth-3", name: "ブース 3", type: "booth", capacity: 1, openTime: "09:00", closeTime: "20:00", availableDays: [1, 2, 3, 4, 5, 6], order: 6 },
];

/** トレーラー: Square決済＋SwitchBot解錠＋長い規約。決済〜解錠の通し確認用。 */
const TRAILER_FACILITY: FacilitySeed = {
  id: TRAILER_ID,
  name: "エイトトレーラー（検証）",
  type: "activity",
  capacity: 4,
  openTime: "10:00",
  closeTime: "22:00",
  availableDays: [0, 1, 2, 3, 4, 5, 6],
  minDuration: 60,
  fixedDuration: true,
  requireTerms: true,
  termsContent: LONG_TERMS,
  paymentAmount: 20000,
  switchBotDeviceId: KEYPAD_DEVICE_ID,
  order: 80,
};

export interface AppSeedSummary {
  facilities: number;
  news: number;
  events: number;
  posts: number;
  seasons: number;
  games: Record<string, unknown>;
  sauna: Record<string, unknown>;
  notes: string[];
}

/** 施設を upsert する。calendarId は既存値を優先して引き継ぐ（GCal 連携を壊さない）。 */
async function upsertFacility(f: FacilitySeed, fallbackCalendarId: string): Promise<void> {
  const db = getDb();
  const ref = db.collection("facilities").doc(f.id);
  const existing = await ref.get();
  const calendarId =
    (existing.data()?.calendarId as string | undefined)?.trim() || fallbackCalendarId;
  const nowIso = new Date().toISOString();

  await ref.set(
    {
      name: f.name,
      type: f.type,
      capacity: f.capacity,
      calendarId,
      active: true,
      order: f.order,
      openTime: f.openTime,
      closeTime: f.closeTime,
      availableDays: f.availableDays,
      ...(f.minDuration !== undefined ? { minDuration: f.minDuration } : {}),
      ...(f.fixedDuration !== undefined ? { fixedDuration: f.fixedDuration } : {}),
      ...(f.requireTerms ? { requireTerms: true, termsContent: f.termsContent ?? "" } : {}),
      ...(f.paymentAmount !== undefined ? { paymentAmount: f.paymentAmount } : {}),
      ...(f.switchBotDeviceId ? { switchBotDeviceId: f.switchBotDeviceId } : {}),
      ...(f.minAdvanceDays !== undefined ? { minAdvanceDays: f.minAdvanceDays } : {}),
      createdAt: (existing.data()?.createdAt as string | undefined) ?? nowIso,
      updatedAt: nowIso,
      // 標準施設（固定ID）にはタグを付けない＝削除で消さない。demo- 始まりだけ消す。
      ...(f.id.startsWith(DEMO_FACILITY_PREFIX) ? DUMMY_FLAG : {}),
    },
    { merge: true }
  );
}

/** 既存施設から使える calendarId を1つ借りる（無ければ空文字）。 */
async function borrowCalendarId(): Promise<string> {
  const snap = await getDb().collection("facilities").get();
  for (const doc of snap.docs) {
    const cid = (doc.data().calendarId as string | undefined)?.trim();
    if (cid) return cid;
  }
  return "";
}

/** ニュース・イベント・掲示板を投入する（お知らせ/イベント/掲示板の画面が空にならないように）。 */
async function seedContent(): Promise<{ news: number; events: number; posts: number }> {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const today = todayJst();

  const news = [
    { id: "demo-news-1", title: "EIGHT BASE UNGA オープンのお知らせ", body: "コワーキングスペースがオープンしました。会議室・ブースのご予約はアプリから行えます。", category: "info", priority: "high" },
    { id: "demo-news-2", title: "サウナのご利用について", body: "サウナは土曜日のみの営業です。安全のため**お一人でのご利用はできません**。ご予約時に一緒に入る方をお選びください。", category: "facility", priority: "medium" },
    { id: "demo-news-3", title: "麻雀リーグ 参加者募集", body: "月1回の麻雀リーグを開催しています。ゲームタブからご参加ください。", category: "community", priority: "normal" },
  ];
  for (const n of news) {
    await db.collection("news").doc(n.id).set({
      title: n.title,
      body: n.body,
      category: n.category,
      priority: n.priority,
      published: true,
      publishedAt: nowIso,
      lineNotify: false, // ⚠️ シード投入でLINE配信させない
      createdAt: nowIso,
      ...DUMMY_FLAG,
    });
  }

  const events = [
    { id: "demo-event-1", title: "交流会（もくもく会）", category: "community", days: 3, location: "1F ラウンジ", description: "各自の作業を持ち寄って集まる会です。出入り自由。" },
    { id: "demo-event-2", title: "ビリヤード大会", category: "game", days: 10, location: "2F ゲームスペース", description: "初心者歓迎。ルール説明から行います。" },
  ];
  for (const e of events) {
    const date = addDaysJst(today, e.days);
    await db.collection("events").doc(e.id).set({
      title: e.title,
      category: e.category,
      description: e.description,
      startAt: `${date}T19:00:00+09:00`,
      endAt: `${date}T21:00:00+09:00`,
      location: e.location,
      published: true,
      lineNotify: false, // ⚠️ シード投入でLINE配信させない
      createdAt: nowIso,
      ...DUMMY_FLAG,
    });
  }

  // 掲示板。投稿者はサウナ用に作るダミーアカウント（実在するので「LINEで連絡」も検証できる）。
  const posts = [
    { id: "demo-post-1", authorId: "demo-sauna-01", authorName: "山田 太郎", type: "question", content: "会議室の予約は何日前から取れますか？", tags: ["予約", "会議室"] },
    { id: "demo-post-2", authorId: "demo-sauna-04", authorName: "佐々木 みなみ", type: "info", content: "2Fのゲームスペース、平日夜は空いていることが多いです。", tags: ["ゲーム"] },
    { id: "demo-post-3", authorId: "demo-sauna-07", authorName: "高橋 直樹", type: "recruit", content: "サウナ一緒に入る方を探しています。土曜の夕方希望です。", tags: ["サウナ", "募集"] },
  ];
  for (const p of posts) {
    await db.collection("posts").doc(p.id).set({
      authorId: p.authorId,
      authorName: p.authorName,
      authorPictureUrl: "",
      type: p.type,
      content: p.content,
      tags: p.tags,
      likes: [],
      commentCount: 0,
      createdAt: nowIso,
      ...DUMMY_FLAG,
    });
  }

  return { news: news.length, events: events.length, posts: posts.length };
}

/** 4種目のシーズンを作って active にする（種目ごとに1つ）。 */
async function seedSeasons(): Promise<Record<ScoreboardGameId, string>> {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const today = todayJst();
  const games: { id: ScoreboardGameId; label: string }[] = [
    { id: "mahjong", label: "麻雀" },
    { id: "darts", label: "ダーツ" },
    { id: "billiards", label: "ビリヤード" },
    { id: "poker", label: "ポーカー" },
  ];

  const ids = {} as Record<ScoreboardGameId, string>;
  for (const g of games) {
    const seasonId = `demo-season-${g.id}`;
    ids[g.id] = seasonId;

    // 同種目の他シーズンを非アクティブ化（active は種目ごとに1つ）
    const activeSnap = await db
      .collection("seasons")
      .where("active", "==", true)
      .get();
    for (const doc of activeSnap.docs) {
      if (doc.id === seasonId) continue;
      if ((doc.data().gameCategory ?? "mahjong") !== g.id) continue;
      await doc.ref.update({ active: false, updatedAt: nowIso });
    }

    await db.collection("seasons").doc(seasonId).set({
      name: `検証シーズン（${g.label}）`,
      gameCategory: g.id,
      startDate: addDaysJst(today, -30),
      endDate: addDaysJst(today, 300),
      active: true,
      csConfig: { mahjong: { topN: 8 }, darts: { topN: 8 }, billiards: { topN: 8 }, poker: { topN: 8 } },
      defaultStartTime: "13:00",
      defaultEndTime: "18:00",
      createdAt: nowIso,
      updatedAt: nowIso,
      ...DUMMY_FLAG,
    });
  }
  return ids;
}

/**
 * demo 環境をアプリ全体で整える（冪等）。
 * @returns 投入内容のサマリ
 */
export async function seedDemoApp(): Promise<AppSeedSummary> {
  const notes: string[] = [];

  // 1) 施設。標準施設は固定IDで upsert（二重登録しない）。calendarId は既存値を引き継ぐ。
  const borrowed = await borrowCalendarId();
  if (!borrowed) {
    notes.push(
      "Google Calendar ID を借りられる既存施設がありませんでした。予約は Firestore 上は動きますが GCal 連携は失敗します（カレンダー管理で設定してください）。"
    );
  }
  for (const f of STANDARD_FACILITIES) await upsertFacility(f, borrowed);
  await upsertFacility(TRAILER_FACILITY, borrowed);
  const facilityCount = STANDARD_FACILITIES.length + 1;

  // 2) サウナ（同伴者必須）＋同伴者候補アカウント。掲示板の投稿者もこのアカウントを使う。
  const sauna = await seedSaunaDemo();

  // 3) コンテンツ（ニュース・イベント・掲示板）
  const content = await seedContent();

  // 4) ゲーム4種目: シーズンを作って既存の種目別シードに委譲
  const seasonIds = await seedSeasons();
  const games: Record<string, unknown> = {};
  games.mahjong = await seedDemoParticipants(seasonIds.mahjong);
  games.darts = await seedDemoDartsParticipants(seasonIds.darts);
  games.billiards = await seedDemoBilliardsParticipants(seasonIds.billiards);
  games.poker = await seedDemoPokerParticipants(seasonIds.poker);

  notes.push(
    "予約はサウナの1件（自分が同伴者）だけ投入しています。予約フローは利用者アプリで実際に取って確認してください。"
  );
  notes.push(
    "会議室C は短い規約・トレーラーは長い規約にしています（規約が短いと同意ボタンが出ない不具合の再発チェック用）。"
  );

  return {
    facilities: facilityCount,
    news: content.news,
    events: content.events,
    posts: content.posts,
    seasons: Object.keys(seasonIds).length,
    games,
    sauna: sauna as unknown as Record<string, unknown>,
    notes,
  };
}

export interface AppClearSummary {
  [collection: string]: number;
}

/**
 * 投入した demo データを削除する。
 *
 * ⚠️ 施設は **`demo-` 始まりのIDだけ**消す。標準施設（`meetingroom-a` 等）は
 *    demo の土台なので残す（消すと demo が空になって余計に確認しづらくなる）。
 */
export async function clearDemoApp(): Promise<AppClearSummary> {
  const db = getDb();
  const result: AppClearSummary = {};

  // サウナ（施設・アカウント・予約・GCal）は専用の削除に委譲
  const sauna = await clearSaunaDemo();
  for (const [k, v] of Object.entries(sauna)) result[`sauna.${k}`] = v;

  // タグ付きの投入物を削除
  const tagged = [
    "news",
    "events",
    "posts",
    "seasons",
    "mahjongEntries", "mahjongTables", "mahjongSchedule", "mahjongCsEvents", "mahjongDayState",
    "dartsEntries", "dartsSchedule", "dartsCsEvents", "dartsDayState", "dartsCancelledDates",
    "billiardsEntries", "billiardsSchedule", "billiardsCsEvents", "billiardsDayState", "billiardsCancelledDates",
    "pokerEntries", "pokerSchedule", "pokerDayState", "pokerCancelledDates", "pokerCsEvents",
    "scores", "games",
  ];
  for (const col of tagged) {
    const snap = await db.collection(col).where("demoDummy", "==", true).get();
    let deleted = 0;
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = db.batch();
      for (const doc of snap.docs.slice(i, i + 400)) batch.delete(doc.ref);
      await batch.commit();
      deleted += Math.min(400, snap.docs.length - i);
    }
    result[col] = deleted;
  }

  // 施設は demo- 始まりのタグ付きだけ
  const facSnap = await db.collection("facilities").where("demoDummy", "==", true).get();
  const facTargets = facSnap.docs.filter((d) => d.id.startsWith(DEMO_FACILITY_PREFIX));
  for (const doc of facTargets) await doc.ref.delete();
  result.facilities = facTargets.length;

  return result;
}
