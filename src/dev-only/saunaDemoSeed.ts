/**
 * 【develop 専用 / main へ入れない】サウナ予約（同伴者必須）の検証データ投入・削除。
 *
 * 目的: サウナ＝「1人では予約できない施設」（`Facility.requireCompanions`）を demo で通しで確認する。
 * 同伴者ピッカーは **実在するアプリ利用者**（`authorizedUsers.active=true` かつゲスト以外）しか候補に
 * 出さないので、麻雀の `demoSeed.ts` のように「名前だけのダミー」では検証できない。
 * ここは例外的に **アカウント（authorizedUsers / users）を作る**。
 *
 * 方針:
 * - 投入する全ドキュメントに `demoDummy: true` を付け、削除はこのタグのみを対象にする。
 * - さらにアカウント削除は `lineUserId` が `demo-sauna-` で始まるものに限定する（タグの付け間違いで
 *   実ユーザーを消さないための二重ガード）。**quick-login の dev-member-01 等には一切触れない**。
 * - 施設は固定 doc ID `demo-sauna` を set()＝冪等。何度実行しても増えない。
 * - 予約は「**demoユーザーが同伴者として招ばれている1件**」だけ入れる。ダミーはログインできないので
 *   この状態だけは手作業で作れない（＝マイ予約の同伴者表示・解錠コード非表示の確認用）。
 *   予約者側の確認は利用者アプリで実際に予約すればよいので投入しない。
 *
 * ⚠️ 予約の真実の源は Firestore（`reservations` + `reservationLocks`）。投入・削除では必ず両方を揃える。
 *    空き状況は `getBlockingLockedSlots()`＝ロックを見るので、ロックを作らないと空きが埋まらない。
 */

import { getDb } from "@/lib/firebaseAdmin";
import { upcomingSaturdayJst } from "@/lib/date";
import { buildReservationSlotKey, earliestBookableDate } from "@/lib/reservations";
import { deleteCalendarEvent } from "@/lib/googleCalendar";
// ⚠️ 参加者種別は `@/lib/roles` の UserRole（member/guest/staff）。
//    `@/types` の同名 UserRole は別物（tenant/coworking/admin）なので取り違えない。
import type { UserRole } from "@/lib/roles";
import type { ReservationCompanion } from "@/types";

const DUMMY_FLAG = { demoDummy: true } as const;

/** 検証用サウナ施設の固定 doc ID（＝facilityId）。 */
export const DEMO_SAUNA_FACILITY_ID = "demo-sauna";

/** ダミーアカウントの lineUserId 接頭辞。削除時のガードにも使う。 */
const ACCOUNT_PREFIX = "demo-sauna-";

/** 同伴者として予約に招ばれる「自分」＝ quick-login（会員）の固定ユーザー。 */
const SELF_LINE_USER_ID = "dev-member-01";
const SELF_DISPLAY_NAME = "demoユーザー";

/** 投入する予約の時間帯（施設は 60 分の固定枠なので枠の境界に合わせる）。 */
const RESERVATION_START = "17:00";
const RESERVATION_END = "18:00";

/** 予約ドキュメントの固定 ID（冪等・再投入で増えない）。 */
const RESERVATION_DOC_ID = "demo-sauna-res-companion";

/** 直前予約の禁止: 利用日の何日前までに予約が必要か（1週間前まで）。 */
const MIN_ADVANCE_DAYS = 7;

interface DemoAccount {
  lineUserId: string;
  displayName: string;
  role: UserRole;
  active: boolean;
  companyName: string;
  jobTitle: string;
  /** 候補に出るべきか（false = guest / 無効ユーザー＝出ないことの確認用） */
  selectable: boolean;
  /** この人を入れた理由。UI の説明とテストの意図を一致させるため残す。 */
  note: string;
}

/**
 * 同伴者ピッカーの検証用アカウント。
 * 予測変換（`kanaIncludes`＝ひらがな/カタカナ・大小文字を吸収）と「同姓同名を会社名で見分ける」
 * ケースを必ず含める。ここが崩れると本番で人を選び間違える。
 */
const ACCOUNTS: DemoAccount[] = [
  {
    lineUserId: "demo-sauna-01",
    displayName: "山田 太郎",
    role: "member",
    active: true,
    companyName: "株式会社アルファ",
    jobTitle: "代表取締役",
    selectable: true,
    note: "同姓同名A（会社名で見分ける）",
  },
  {
    lineUserId: "demo-sauna-02",
    displayName: "山田 太郎",
    role: "member",
    active: true,
    companyName: "ベータ工房",
    jobTitle: "木工職人",
    selectable: true,
    note: "同姓同名B（会社名で見分ける）",
  },
  {
    lineUserId: "demo-sauna-03",
    displayName: "山田 花子",
    role: "member",
    active: true,
    companyName: "株式会社アルファ",
    jobTitle: "デザイナー",
    selectable: true,
    note: "同姓（「やまだ」で3件ヒット）",
  },
  {
    lineUserId: "demo-sauna-04",
    displayName: "佐々木 みなみ",
    role: "member",
    active: true,
    companyName: "ささきデザイン事務所",
    jobTitle: "アートディレクター",
    selectable: true,
    note: "会社名（ひらがな）でもヒットする",
  },
  {
    lineUserId: "demo-sauna-05",
    displayName: "ヤマグチ 健",
    role: "member",
    active: true,
    companyName: "山口製作所",
    jobTitle: "工場長",
    selectable: true,
    note: "カタカナ氏名を「やまぐち」で引く",
  },
  {
    lineUserId: "demo-sauna-06",
    displayName: "Chris Aoki",
    role: "member",
    active: true,
    companyName: "Aoki Studio",
    jobTitle: "Photographer",
    selectable: true,
    note: "英字（大文字小文字を無視してヒット）",
  },
  {
    lineUserId: "demo-sauna-07",
    displayName: "高橋 直樹",
    role: "staff",
    active: true,
    companyName: "エイトデザイン株式会社",
    jobTitle: "設計",
    selectable: true,
    note: "エイト社員も同伴者に選べる（会員同等）",
  },
  {
    lineUserId: "demo-sauna-08",
    displayName: "ゲスト 一郎",
    role: "guest",
    active: true,
    companyName: "",
    jobTitle: "",
    selectable: false,
    note: "ゲストは候補に出ない",
  },
  {
    lineUserId: "demo-sauna-09",
    displayName: "退会 花子",
    role: "member",
    active: false,
    companyName: "旧テナント",
    jobTitle: "",
    selectable: false,
    note: "無効(active=false)は候補に出ない",
  },
];

export interface SaunaDemoSeedSummary {
  facilityId: string;
  facilityName: string;
  /** 施設に設定した Google Calendar ID（空 = 未解決） */
  calendarId: string;
  /** calendarId をどこから取ったか。"none" のときは予約 POST が失敗する（要手動設定） */
  calendarIdSource: "request" | "env" | "copied" | "none";
  /** copied のとき、コピー元の施設名 */
  copiedFrom?: string;
  minPartySize: number;
  maxCompanions: number;
  /** 直前予約の禁止日数（利用日の何日前までに予約が必要か） */
  minAdvanceDays: number;
  /** 上記を踏まえて予約できる最も早い日（YYYY-MM-DD） */
  earliestBookableDate: string;
  /** 候補に出るアカウント数 */
  selectable: number;
  /** 候補に出ないアカウント数（guest / 無効） */
  excluded: number;
  /** 「自分が同伴者」の投入予約の日付・時間帯 */
  reservationDate: string;
  reservationTime: string;
}

/** 施設に使う calendarId を決める。既存施設からのコピーは最後の手段（共有＝相互に空きを塞ぐ）。 */
async function resolveCalendarId(
  db: FirebaseFirestore.Firestore,
  requested?: string
): Promise<{ calendarId: string; source: SaunaDemoSeedSummary["calendarIdSource"]; copiedFrom?: string }> {
  const fromRequest = (requested ?? "").trim();
  if (fromRequest) return { calendarId: fromRequest, source: "request" };

  const fromEnv = (process.env.CALENDAR_ID_SAUNA ?? "").trim();
  if (fromEnv) return { calendarId: fromEnv, source: "env" };

  // 既存施設から借りる。GCal を共有するので、その施設の予約とサウナの予約が
  // 互いの空きを塞ぐ（予約 POST の事前チェック assertCalendarSlotFree が GCal を見るため）。
  // 検証を止めないための最後の手段で、専用カレンダーを用意するのが本来。
  const snap = await db.collection("facilities").get();
  for (const doc of snap.docs) {
    if (doc.id === DEMO_SAUNA_FACILITY_ID) continue;
    const d = doc.data();
    const cid = typeof d.calendarId === "string" ? d.calendarId.trim() : "";
    if (!cid) continue;
    return { calendarId: cid, source: "copied", copiedFrom: d.name || doc.id };
  }

  return { calendarId: "", source: "none" };
}

/**
 * サウナ検証データを投入する（冪等）。
 * @param options.calendarId 施設に設定する Google Calendar ID（省略時は env → 既存施設からコピー）
 */
export async function seedSaunaDemo(
  options: { calendarId?: string } = {}
): Promise<SaunaDemoSeedSummary> {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const eventDate = upcomingSaturdayJst();

  // 0) 前回の予約/ロックを先に片付ける（再投入＝やり直し。開催日が週をまたぐと
  //    古い日付のロックが残って空きを塞ぎ続けるため）。
  await clearSaunaReservations(db);

  // 1) 施設（サウナ）。土曜のみ・60分の固定枠・同伴者必須。
  //    ⚠️ requirePayment / paymentAmount / switchBotDeviceId は付けない
  //       （有料施設はオンライン予約不可＝POST が 501 で弾かれ、同伴者の検証に入れない）。
  const { calendarId, source, copiedFrom } = await resolveCalendarId(db, options.calendarId);
  const capacity = 4; // → 同伴者の上限は capacity-1 = 3名
  const minPartySize = 2;
  await db
    .collection("facilities")
    .doc(DEMO_SAUNA_FACILITY_ID)
    .set({
      name: "サウナ（検証）",
      type: "activity",
      capacity,
      calendarId,
      active: true,
      order: 90,
      openTime: "10:00",
      closeTime: "22:00",
      // 本番のサウナと同じ「土曜のみ営業」。TZ=UTC でも土曜が出ることの確認を兼ねる
      //（`dayOfWeek()` を使わず getDay() に戻すと本番だけ予約不能になる回帰があった）。
      availableDays: [6],
      minDuration: 60,
      fixedDuration: true,
      // 直前予約の禁止: 利用日の1週間前までに予約が必要（＝今日+7 以降しか選べない）。
      minAdvanceDays: MIN_ADVANCE_DAYS,
      // 同伴者必須（サウナ＝1人では入れない）
      requireCompanions: true,
      minPartySize,
      createdAt: nowIso,
      updatedAt: nowIso,
      ...DUMMY_FLAG,
    });

  // 2) 同伴者候補のアカウント。authorizedUsers（身分の正）と users（表示名・アバター・会社名）の両方。
  //    skills は**入れない**。`/api/members` はスキル未登録者を落とすのでメンバー一覧は汚れず、
  //    それでも同伴者候補には出る＝「候補に /api/members を使わない」理由をそのまま検証できる。
  for (const a of ACCOUNTS) {
    // authorizedUsers は doc ID = lineUserId で作る（本番は自動IDだが、検証では冪等性を優先）。
    // 参照側は `where("lineUserId","==",…)` / `in` なので doc ID の付け方に依存しない。
    await db
      .collection("authorizedUsers")
      .doc(a.lineUserId)
      .set({
        displayName: a.displayName,
        email: "",
        passwordHash: "",
        salt: "",
        lineUserId: a.lineUserId,
        active: a.active,
        role: a.role,
        profileComplete: true,
        profile: {
          companyName: a.companyName,
          jobTitle: a.jobTitle,
        },
        createdAt: nowIso,
        lastLoginAt: nowIso,
        invitationId: null,
        inviteStatus: "linked",
        ...DUMMY_FLAG,
      });

    await db
      .collection("users")
      .doc(a.lineUserId)
      .set({
        lineUserId: a.lineUserId,
        displayName: a.displayName,
        lineDisplayName: a.displayName,
        pictureUrl: "",
        memberProfile: {
          companyName: a.companyName,
          jobTitle: a.jobTitle,
        },
        createdAt: nowIso,
        updatedAt: nowIso,
        ...DUMMY_FLAG,
      });
  }

  // 3) 「自分（demoユーザー）が同伴者として招ばれている」予約を1件。
  //    ダミーはログインできないので、この状態だけは手作業で作れない。
  //    マイ予約で isCompanion=true の表示・キャンセル不可・解錠コード非表示を確認する。
  const organizer = ACCOUNTS[0]; // 山田 太郎（株式会社アルファ）
  const companions: ReservationCompanion[] = [
    { lineUserId: SELF_LINE_USER_ID, displayName: SELF_DISPLAY_NAME },
    { lineUserId: ACCOUNTS[2].lineUserId, displayName: ACCOUNTS[2].displayName },
  ];
  await db
    .collection("reservations")
    .doc(RESERVATION_DOC_ID)
    .set({
      facilityId: DEMO_SAUNA_FACILITY_ID,
      facilityName: "サウナ（検証）",
      lineUserId: organizer.lineUserId,
      date: eventDate,
      startTime: RESERVATION_START,
      endTime: RESERVATION_END,
      // 投入データは GCal にイベントを作らない（空文字なら管理キャンセルも GCal を叩かない）。
      googleEventId: "",
      status: "confirmed",
      companions,
      companionIds: companions.map((c) => c.lineUserId),
      partySize: 1 + companions.length,
      organizerName: organizer.displayName,
      createdAt: nowIso,
      ...DUMMY_FLAG,
    });

  // 4) 予約に対応するロック。空き状況（getBlockingLockedSlots）はこれを正とするので必須。
  await db
    .collection("reservationLocks")
    .doc(
      buildReservationSlotKey(DEMO_SAUNA_FACILITY_ID, eventDate, RESERVATION_START, RESERVATION_END)
    )
    .set({
      facilityId: DEMO_SAUNA_FACILITY_ID,
      date: eventDate,
      startTime: RESERVATION_START,
      endTime: RESERVATION_END,
      status: "confirmed",
      lineUserId: organizer.lineUserId,
      reservationId: RESERVATION_DOC_ID,
      createdAt: nowIso,
      ...DUMMY_FLAG,
    });

  return {
    facilityId: DEMO_SAUNA_FACILITY_ID,
    facilityName: "サウナ（検証）",
    calendarId,
    calendarIdSource: source,
    ...(copiedFrom ? { copiedFrom } : {}),
    minPartySize,
    maxCompanions: capacity - 1,
    minAdvanceDays: MIN_ADVANCE_DAYS,
    earliestBookableDate: earliestBookableDate({ minAdvanceDays: MIN_ADVANCE_DAYS }),
    selectable: ACCOUNTS.filter((a) => a.selectable).length,
    excluded: ACCOUNTS.filter((a) => !a.selectable).length,
    reservationDate: eventDate,
    reservationTime: `${RESERVATION_START}〜${RESERVATION_END}`,
  };
}

/**
 * サウナ施設に紐づく予約とロックを消す。
 *
 * 投入した1件（demoDummy）だけでなく、**検証中に実際に予約した分も消す**。
 * 施設ごと消すのに予約だけ残すと、施設のない予約とロックが残って空きが永久に塞がるため。
 * 実予約は GCal にイベントがあるので、そちらも best-effort で消す（残すと事前チェック
 * assertCalendarSlotFree がその枠を予約済みと判定し続ける）。
 */
async function clearSaunaReservations(
  db: FirebaseFirestore.Firestore
): Promise<{ reservations: number; locks: number; calendarEvents: number }> {
  // 施設の calendarId は削除前に読む（施設 doc を消した後では引けない）。
  const facilityDoc = await db.collection("facilities").doc(DEMO_SAUNA_FACILITY_ID).get();
  const calendarId = (facilityDoc.data()?.calendarId as string | undefined) ?? "";

  const [resSnap, lockSnap] = await Promise.all([
    db.collection("reservations").where("facilityId", "==", DEMO_SAUNA_FACILITY_ID).get(),
    db.collection("reservationLocks").where("facilityId", "==", DEMO_SAUNA_FACILITY_ID).get(),
  ]);

  let calendarEvents = 0;
  if (calendarId) {
    for (const doc of resSnap.docs) {
      const eventId = doc.data().googleEventId as string | undefined;
      if (!eventId) continue;
      try {
        await deleteCalendarEvent(calendarId, eventId);
        calendarEvents++;
      } catch (error) {
        // 消えていた / 権限が無い等。予約データの削除は続ける。
        console.warn("[saunaDemoSeed] calendar event delete failed:", eventId, error);
      }
    }
  }

  await deleteAll(db, [...resSnap.docs, ...lockSnap.docs]);
  return { reservations: resSnap.docs.length, locks: lockSnap.docs.length, calendarEvents };
}

/** バッチ上限(500)を考慮して分割コミットで消す。 */
async function deleteAll(
  db: FirebaseFirestore.Firestore,
  docs: FirebaseFirestore.QueryDocumentSnapshot[] | FirebaseFirestore.DocumentSnapshot[]
): Promise<void> {
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch();
    for (const doc of docs.slice(i, i + 400)) batch.delete(doc.ref);
    await batch.commit();
  }
}

export interface SaunaDemoClearSummary {
  facilities: number;
  authorizedUsers: number;
  users: number;
  reservations: number;
  reservationLocks: number;
  calendarEvents: number;
}

/**
 * 投入したサウナ検証データを削除する。
 *
 * アカウントの削除は `demoDummy` タグ **かつ** lineUserId が `demo-sauna-` で始まるものに限定する
 * （タグの付け間違いで quick-login や実ユーザーを消さないための二重ガード）。
 */
export async function clearSaunaDemo(): Promise<SaunaDemoClearSummary> {
  const db = getDb();

  // 1) 予約・ロック（＋GCal イベント）。施設を消す前に実行する。
  const { reservations, locks, calendarEvents } = await clearSaunaReservations(db);

  // 2) アカウント（authorizedUsers / users）。接頭辞ガード付き。
  const counts: Record<"authorizedUsers" | "users", number> = { authorizedUsers: 0, users: 0 };
  for (const col of ["authorizedUsers", "users"] as const) {
    const snap = await db.collection(col).where("demoDummy", "==", true).get();
    const targets = snap.docs.filter((doc) => {
      const id = doc.data().lineUserId;
      return typeof id === "string" && id.startsWith(ACCOUNT_PREFIX);
    });
    await deleteAll(db, targets);
    counts[col] = targets.length;
  }

  // 3) 施設。固定 ID なので他の施設に触れない。
  const facilityRef = db.collection("facilities").doc(DEMO_SAUNA_FACILITY_ID);
  const facilityDoc = await facilityRef.get();
  const facilities = facilityDoc.exists && facilityDoc.data()?.demoDummy === true ? 1 : 0;
  if (facilities) await facilityRef.delete();

  return {
    facilities,
    authorizedUsers: counts.authorizedUsers,
    users: counts.users,
    reservations,
    reservationLocks: locks,
    calendarEvents,
  };
}

/** 管理UIの説明に出す投入内容（コードと説明が乖離しないよう1箇所から配る）。 */
export const SAUNA_DEMO_ACCOUNT_NOTES = ACCOUNTS.map((a) => ({
  displayName: a.displayName,
  companyName: a.companyName,
  role: a.role,
  selectable: a.selectable,
  note: a.note,
}));
