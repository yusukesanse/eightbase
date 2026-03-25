import type { Facility } from "@/types";
import { getDb } from "@/lib/firebaseAdmin";

const COLLECTION = "facilities";

/**
 * Firestore からアクティブな施設一覧を取得（order 昇順）
 * フォールバック: Firestore にデータがなければ旧ハードコード値を返す
 */
export async function getFacilities(): Promise<Facility[]> {
  const db = getDb();
  const snap = await db
    .collection(COLLECTION)
    .get();

  if (!snap.empty) {
    const all = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Facility));
    return all
      .filter((f) => f.active !== false)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  // Firestore にデータがない場合はフォールバック
  return FALLBACK_FACILITIES;
}

/**
 * Firestore から全施設を取得（管理画面用 — 非アクティブ含む）
 */
export async function getAllFacilities(): Promise<Facility[]> {
  const db = getDb();
  const snap = await db
    .collection(COLLECTION)
    .get();

  if (!snap.empty) {
    const all = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Facility));
    return all.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  return FALLBACK_FACILITIES;
}

/**
 * Firestore から施設を1件取得
 */
export async function getFacilityById(id: string): Promise<Facility | undefined> {
  const db = getDb();
  const doc = await db.collection(COLLECTION).doc(id).get();
  if (doc.exists) {
    return { id: doc.id, ...doc.data() } as Facility;
  }

  // フォールバック
  return FALLBACK_FACILITIES.find((f) => f.id === id);
}

/**
 * 施設を作成
 */
export async function createFacility(data: Omit<Facility, "id" | "createdAt" | "updatedAt">): Promise<Facility> {
  const db = getDb();
  const now = new Date().toISOString();

  // 次のorder番号を取得
  const snap = await db.collection(COLLECTION).orderBy("order", "desc").limit(1).get();
  const nextOrder = snap.empty ? 1 : ((snap.docs[0].data().order ?? 0) + 1);

  const docRef = await db.collection(COLLECTION).add({
    ...data,
    active: data.active ?? true,
    order: data.order ?? nextOrder,
    createdAt: now,
    updatedAt: now,
  });

  return { id: docRef.id, ...data, order: data.order ?? nextOrder, createdAt: now, updatedAt: now };
}

/**
 * 施設を更新
 */
export async function updateFacility(id: string, data: Partial<Facility>): Promise<void> {
  const db = getDb();
  const { id: _id, createdAt: _ca, ...updateData } = data;
  await db.collection(COLLECTION).doc(id).update({
    ...updateData,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * 施設を削除
 */
export async function deleteFacility(id: string): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTION).doc(id).delete();
}

// ─── フォールバック（旧ハードコード値） ─────────────────────────────────────

export const FALLBACK_FACILITIES: Facility[] = [
  {
    id: "meetingroom-a",
    name: "会議室 A",
    type: "meeting_room",
    capacity: 6,
    calendarId: process.env.CALENDAR_ID_MEETINGROOM_A ?? "meetingroom-a@example.com",
    active: true,
    order: 1,
  },
  {
    id: "meetingroom-b",
    name: "会議室 B",
    type: "meeting_room",
    capacity: 4,
    calendarId: process.env.CALENDAR_ID_MEETINGROOM_B ?? "meetingroom-b@example.com",
    active: true,
    order: 2,
  },
  {
    id: "meetingroom-c",
    name: "会議室 C",
    type: "meeting_room",
    capacity: 8,
    calendarId: process.env.CALENDAR_ID_MEETINGROOM_C ?? "meetingroom-c@example.com",
    active: true,
    order: 3,
  },
  {
    id: "booth-1",
    name: "ブース 1",
    type: "booth",
    capacity: 1,
    calendarId: process.env.CALENDAR_ID_BOOTH_1 ?? "booth-1@example.com",
    active: true,
    order: 4,
  },
  {
    id: "booth-2",
    name: "ブース 2",
    type: "booth",
    capacity: 1,
    calendarId: process.env.CALENDAR_ID_BOOTH_2 ?? "booth-2@example.com",
    active: true,
    order: 5,
  },
  {
    id: "booth-3",
    name: "ブース 3",
    type: "booth",
    capacity: 1,
    calendarId: process.env.CALENDAR_ID_BOOTH_3 ?? "booth-3@example.com",
    active: true,
    order: 6,
  },
];

/**
 * 旧施設データを Firestore に移行するユーティリティ
 * 管理画面の初回アクセス時や、手動で1回だけ実行する
 */
export async function migrateFallbackToFirestore(): Promise<number> {
  const db = getDb();
  const snap = await db.collection(COLLECTION).limit(1).get();
  if (!snap.empty) return 0; // 既にデータがある場合はスキップ

  const batch = db.batch();
  for (const f of FALLBACK_FACILITIES) {
    const now = new Date().toISOString();
    batch.set(db.collection(COLLECTION).doc(f.id), {
      name: f.name,
      type: f.type,
      capacity: f.capacity,
      calendarId: f.calendarId,
      active: true,
      order: f.order ?? 0,
      createdAt: now,
      updatedAt: now,
    });
  }
  await batch.commit();
  return FALLBACK_FACILITIES.length;
}
