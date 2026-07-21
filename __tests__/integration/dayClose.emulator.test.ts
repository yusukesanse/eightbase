/**
 * 開催日「休催（＝流会）」の並行/状態統合テスト（実 Firestore Emulator）。
 *
 * 実際の管理ルート `/api/admin/games/day`（GET/POST）と実 cancel 関数（cancelDay/cancelDartsDay/
 * cancelBilliardsDay）を、Admin SDK を実 Emulator に繋いで動かす。in-memory モックでは分からない
 * 本物のトランザクション/バッチ挙動・返金状態遷移・参加ブロックを検証する。
 * 実行は `npm run test:emulator`（Java 必須）。安全ガードは jest.emulator.setup.ts。
 *
 * 依存の外部副作用のみモック（Firestore は本物）:
 *  - firebaseAdmin.getDb → Emulator db（cancel 関数・ルートが使う）
 *  - adminAuth.checkAdminAuth → 管理者
 *  - line / adminNotify / auditLog → no-op（LINE送信や本番通知を止める）
 */
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/adminAuth", () => ({ checkAdminAuth: jest.fn().mockResolvedValue("admin@test.com") }));
jest.mock("@/lib/auditLog", () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/line", () => ({ sendMahjongForfeitNotice: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/adminNotify", () => ({ notifyAdmin: jest.fn().mockResolvedValue(undefined) }));

import { initializeApp, getApps, deleteApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { GET, POST } from "@/app/api/admin/games/day/route";

let app: App;
let db: Firestore;
let seq = 0;
const freshSeason = () => `emu-close-s${++seq}-${process.pid}`;
const DATE = "2026-07-18";

beforeAll(async () => {
  const projectId = process.env.GCLOUD_PROJECT || "eightbase-emulator-test";
  app = getApps().length ? getApps()[0] : initializeApp({ projectId });
  db = getFirestore(app);
  (getDb as jest.Mock).mockReturnValue(db);
  const ping = db.collection("__warmup").doc("ping"); // gRPC コールドスタート回避
  await ping.set({ t: Date.now() });
  await ping.delete();
});
afterAll(async () => { await Promise.all(getApps().map((a) => deleteApp(a))); });

const COLS = (game: string) => [
  `${game}Entries`, `${game}MonthlyLocks`, `${game}CancelledDates`, `${game}DayState`,
];
async function wipeSeason(seasonId: string) {
  for (const game of ["mahjong", "darts", "billiards"]) {
    for (const col of COLS(game)) {
      const snap = await db.collection(col).where("seasonId", "==", seasonId).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
  }
}

const postClose = (gameCategory: string, seasonId: string, eventDate = DATE) =>
  POST(new NextRequest("http://localhost/api/admin/games/day", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameCategory, seasonId, eventDate }),
  }));
const getDay = (gameCategory: string, seasonId: string, qs = `eventDate=${DATE}`) =>
  GET(new NextRequest(`http://localhost/api/admin/games/day?gameCategory=${gameCategory}&seasonId=${seasonId}&${qs}`));

const entryDoc = (game: string, seasonId: string, uid: string) =>
  db.collection(`${game}Entries`).doc(`${seasonId}_${DATE}_${uid}`);
const seedEntry = (game: string, seasonId: string, uid: string, data: Record<string, unknown>) =>
  entryDoc(game, seasonId, uid).set({ seasonId, eventDate: DATE, lineUserId: uid, displayName: uid.toUpperCase(), ...data });
const seedLock = (game: string, seasonId: string, uid: string) =>
  db.collection(`${game}MonthlyLocks`).doc(`${seasonId}_${uid}_${DATE.slice(0, 7)}`).set({ seasonId, lineUserId: uid, eventDate: DATE });

describe("休催（流会）統合: 実ルート＋実cancel＋実Firestore", () => {
  test("darts: 休催で paid→cancelRequested・reserved削除・lock解放・cancelledDates記録、GETとidempotent", async () => {
    const s = freshSeason();
    try {
      await seedEntry("darts", s, "a", { status: "paid", paymentStatus: "paid", paymentTransactionId: "ord-a", paymentAmount: 500 });
      await seedEntry("darts", s, "b", { status: "paid", paymentStatus: "paid" }); // staff相当（txなし＝返金対象外）
      await seedEntry("darts", s, "c", { status: "reserved" });
      await Promise.all([seedLock("darts", s, "a"), seedLock("darts", s, "b"), seedLock("darts", s, "c")]);

      const res = await postClose("darts", s);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ success: true, paidCount: 2, refundCount: 1 });

      // 実決済者 a は返金対象へ
      const a = (await entryDoc("darts", s, "a").get()).data();
      expect(a?.status).toBe("cancelRequested");
      expect(a?.paymentStatus).toBe("cancelRequested");
      // staff b は paid のまま（返金対象外）
      expect((await entryDoc("darts", s, "b").get()).data()?.status).toBe("paid");
      // reserved c は削除
      expect((await entryDoc("darts", s, "c").get()).exists).toBe(false);
      // lock 全解放
      expect((await db.collection("dartsMonthlyLocks").doc(`${s}_a_${DATE.slice(0, 7)}`).get()).exists).toBe(false);
      // cancelledDates 記録
      expect((await db.collection("dartsCancelledDates").doc(DATE).get()).exists).toBe(true);

      // GET: 休催＝closed、参加者と件数
      const g = await getDay("darts", s);
      const gb = await g.json();
      expect(gb.closed).toBe(true);
      expect(gb.counts).toMatchObject({ total: 2, paid: 1 }); // a(cancelRequested)+b(paid)。c は削除済み

      // 二重休催は idempotent
      const res2 = await postClose("darts", s);
      expect(res2.status).toBe(200);
      expect((await res2.json()).already).toBe(true);
    } finally {
      await wipeSeason(s);
    }
  });

  test("mahjong: 休催後に entry ガードが新規参加を弾き、既存(返金待ち)は no-op で壊さない", async () => {
    const s = freshSeason();
    try {
      await seedEntry("mahjong", s, "a", { status: "paid", paymentStatus: "paid", paymentTransactionId: "ord-a", paymentAmount: 500 });
      const res = await postClose("mahjong", s);
      expect(res.status).toBe(200);
      expect((await db.collection("mahjongCancelledDates").doc(DATE).get()).exists).toBe(true);
      expect((await entryDoc("mahjong", s, "a").get()).data()?.status).toBe("cancelRequested");

      // ↓ mahjong entries POST の cancelledDates ガードと同一ロジック（route.ts の tx 内 ID 読み）を実Firestoreで再現。
      const guardTx = (uid: string) =>
        db.runTransaction(async (tx) => {
          const ref = entryDoc("mahjong", s, uid);
          const entrySnap = await tx.get(ref);
          const cancelSnap = await tx.get(db.collection("mahjongCancelledDates").doc(DATE));
          if (cancelSnap.exists) { if (entrySnap.exists) return; throw new Error("CANCELLED"); }
          tx.set(ref, { seasonId: s, eventDate: DATE, lineUserId: uid, status: "reserved" });
        });

      // 新規は弾かれる
      await expect(guardTx("newbie")).rejects.toThrow("CANCELLED");
      expect((await entryDoc("mahjong", s, "newbie").get()).exists).toBe(false);
      // 既存(返金待ち)の再POSTは no-op で cancelRequested を壊さない
      await expect(guardTx("a")).resolves.toBeUndefined();
      expect((await entryDoc("mahjong", s, "a").get()).data()?.status).toBe("cancelRequested");
    } finally {
      await wipeSeason(s);
    }
  });

  test("billiards: 参加者なしでも休催でき、reserved は削除・cancelledDates記録", async () => {
    const s = freshSeason();
    try {
      await seedEntry("billiards", s, "c", { status: "reserved" });
      const res = await postClose("billiards", s);
      expect(res.status).toBe(200);
      expect((await entryDoc("billiards", s, "c").get()).exists).toBe(false);
      expect((await db.collection("billiardsCancelledDates").doc(DATE).get()).exists).toBe(true);
      // list=1 で休催日一覧に出る
      const g = await getDay("billiards", s, "list=1");
      expect((await g.json()).closedDates).toContain(DATE);
    } finally {
      await wipeSeason(s);
    }
  });
});
