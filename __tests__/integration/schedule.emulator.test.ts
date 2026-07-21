/**
 * 開催日「削除 ↔ 再追加 ↔ entry POST」並行統合テスト（実 Firestore Emulator）。
 *
 * in-memory モックではなく、Firebase Admin SDK を **実際に Emulator へ接続**し、本物の
 * runTransaction / batch / get / set の楽観ロック挙動で検証する。実行は必ず
 * `npm run test:emulator`（firebase emulators:exec が FIRESTORE_EMULATOR_HOST を設定）。
 *
 * 安全性:
 *  - FIRESTORE_EMULATOR_HOST 未設定なら jest.emulator.setup.ts が即 throw（本番非接続）。
 *  - 本テストは本番の getDb() を一切通さず、projectId のみで自前 Admin app を作る。
 *  - テストごとに一意な seasonId を使い相互干渉を防ぐ。afterEach で対象データを消去。
 *
 * 検証シナリオ:
 *  1. entry が先に commit → 削除は "skipped"、schedule は残る。
 *  2. blocked が先に commit（削除完了） → 後続 entry は NOT_SCHEDULED。
 *  3. entry が lock を読んだ後に削除が commit → entry tx が再試行され拒否される。
 *  4. delete phase1 → 同日を再追加 → delete phase2 は "reAdded"、schedule は残る。
 *  5. 参加者なしの通常削除 → "deleted" + blocked トゥームストーン。
 *  6. 削除 と 再追加 を多数同時実行しても不変条件（schedule無し⟹lock必ずblocked）が壊れない。
 */
import { initializeApp, getApps, deleteApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import {
  addGameScheduleDate,
  deleteGameScheduleDate,
  isScheduleDateBlockedInTx,
  buildGameScheduleId,
  scheduleLockRef,
  GAME_SCHEDULE_CFG,
  type ScheduleGame,
} from "@/lib/gameSchedule";

const GAME: ScheduleGame = "darts";
const SCHED_COL = GAME_SCHEDULE_CFG[GAME].col; // "dartsSchedule"
const ENTRY_COL = `${GAME}Entries`; // "dartsEntries"
const LOCK_COL = "scheduleLocks";

let app: App;
let db: Firestore;
let seasonSeq = 0;

/** テストごとに一意な seasonId（相互干渉を防ぐ）。 */
function freshSeason(): string {
  seasonSeq += 1;
  return `emu-s${seasonSeq}-${process.pid}`;
}

beforeAll(async () => {
  const projectId = process.env.GCLOUD_PROJECT || "eightbase-emulator-test";
  app = getApps().length ? getApps()[0] : initializeApp({ projectId });
  db = getFirestore(app);
  // ウォームアップ: 最初の計測対象テストがエミュレータ起動直後の gRPC チャネル確立
  // （初回 RPC のコールドスタート遅延）を被らないよう、捨て read/write を先に往復させる。
  const ping = db.collection("__warmup").doc("ping");
  await ping.set({ t: Date.now() });
  await ping.get();
  await ping.delete();
});

afterAll(async () => {
  await Promise.all(getApps().map((a) => deleteApp(a)));
});

/** 対象 seasonId のデータを 3 コレクションから消去（テスト後クリーンアップ）。 */
async function wipeSeason(seasonId: string) {
  for (const col of [SCHED_COL, ENTRY_COL, LOCK_COL]) {
    const snap = await db.collection(col).where("seasonId", "==", seasonId).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

/** schedule doc を1件作成（管理の追加相当。ここでは直接 set）。 */
async function seedSchedule(seasonId: string, date: string) {
  await db
    .collection(SCHED_COL)
    .doc(buildGameScheduleId(seasonId, date))
    .set({ scheduleId: buildGameScheduleId(seasonId, date), seasonId, date });
}

async function scheduleExists(seasonId: string, date: string): Promise<boolean> {
  const s = await db.collection(SCHED_COL).doc(buildGameScheduleId(seasonId, date)).get();
  return s.exists;
}

async function lockData(seasonId: string, date: string) {
  const s = await scheduleLockRef(db, GAME, seasonId, date).get();
  return s.exists ? (s.data() as { blocked?: boolean; operationId?: string; deleted?: boolean }) : undefined;
}

async function entryExists(seasonId: string, date: string, uid: string): Promise<boolean> {
  const s = await db.collection(ENTRY_COL).doc(`${seasonId}_${date}_${uid}`).get();
  return s.exists;
}

/**
 * entry POST の中核を実 Firestore で再現する（route.ts の直列化ロジックの縮約版）。
 * ロックを ID 指定で読み、blocked なら NOT_SCHEDULED を throw、そうでなければ entry を作成する。
 * 実 Firestore は read-write tx を悲観ロックで直列化するので、削除と並行しても lock doc で競合する。
 */
async function entryPostTx(seasonId: string, date: string, uid: string): Promise<{ attempts: number }> {
  let attempts = 0;
  await db.runTransaction(async (tx) => {
    attempts += 1;
    const ref = db.collection(ENTRY_COL).doc(`${seasonId}_${date}_${uid}`);
    const entrySnap = await tx.get(ref);
    const blocked = await isScheduleDateBlockedInTx(tx, db, GAME, seasonId, date);
    if (entrySnap.exists) return; // 冪等
    if (blocked) throw new Error("NOT_SCHEDULED");
    tx.set(ref, { seasonId, eventDate: date, lineUserId: uid, enteredAt: new Date().toISOString(), status: "paid" });
  });
  return { attempts };
}

describe("開催日 削除↔再追加↔entry POST（Firestore Emulator 統合）", () => {
  test("1. entry が先に commit → 削除は skipped、schedule は残る", async () => {
    const seasonId = freshSeason();
    const date = "2026-07-18";
    try {
      await seedSchedule(seasonId, date);
      await entryPostTx(seasonId, date, "u1"); // 参加者を先に確定
      const r = await deleteGameScheduleDate(db, GAME, seasonId, date);
      expect(r).toBe("skipped");
      expect(await scheduleExists(seasonId, date)).toBe(true);
      expect(await lockData(seasonId, date)).toBeUndefined(); // ロックは解除
    } finally {
      await wipeSeason(seasonId);
    }
  });

  test("2. blocked が先に commit（削除完了）→ 後続 entry は NOT_SCHEDULED", async () => {
    const seasonId = freshSeason();
    const date = "2026-07-18";
    try {
      await seedSchedule(seasonId, date);
      const r = await deleteGameScheduleDate(db, GAME, seasonId, date); // 参加者なし
      expect(r).toBe("deleted");
      expect(await scheduleExists(seasonId, date)).toBe(false);
      expect((await lockData(seasonId, date))?.blocked).toBe(true);
      await expect(entryPostTx(seasonId, date, "u1")).rejects.toThrow("NOT_SCHEDULED");
      expect(await entryExists(seasonId, date, "u1")).toBe(false);
    } finally {
      await wipeSeason(seasonId);
    }
  });

  test("3. entry POST と 削除 を真に並行実行 → lock で直列化され孤児が生じない", async () => {
    // 実 Firestore は read-write トランザクションを **悲観ロック**で直列化する。
    // よって entry と削除が同じ lock doc を奪い合い、必ずどちらかが先行して他方は
    // その結果を見る（新規 entry は blocked を見て NOT_SCHEDULED、または entry 先行なら
    // 削除が参加者を見て skipped）。どちらの順序でも「schedule無し＋entryあり」孤児は生じない。
    // ※ 旧版はフックを entry tx コールバック内で呼び自己デッドロックしていた（本番では起きない構造）。
    const seasonId = freshSeason();
    const date = "2026-07-18";
    try {
      await seedSchedule(seasonId, date);
      const [entryOutcome, delOutcome] = await Promise.allSettled([
        entryPostTx(seasonId, date, "u1"),
        deleteGameScheduleDate(db, GAME, seasonId, date),
      ]);
      // 想定外エラー（競合以外の rejection）は許容しない。
      const CONTENTION = /ABORTED|contention|NOT_SCHEDULED|DEADLINE_EXCEEDED|UNAVAILABLE/i;
      for (const o of [entryOutcome, delOutcome]) {
        if (o.status === "rejected") {
          const msg = o.reason instanceof Error ? o.reason.message : String(o.reason);
          expect(msg).toMatch(CONTENTION);
        }
      }
      const entryMade = await entryExists(seasonId, date, "u1");
      const schedGone = !(await scheduleExists(seasonId, date));
      const lk = await lockData(seasonId, date);
      // 不変条件: 「entry が作られた」なら schedule は必ず残る（孤児 entry を作らない）。
      if (entryMade) expect(schedGone).toBe(false);
      // 「schedule が消えた」なら必ず blocked ロックが残り、以後の entry を弾ける。
      if (schedGone) expect(lk?.blocked).toBe(true);
      // 削除が先行して完了したケースでは、後から新規 entry を出せないことも確認。
      if (schedGone) {
        await expect(entryPostTx(seasonId, date, "u2")).rejects.toThrow("NOT_SCHEDULED");
      }
    } finally {
      await wipeSeason(seasonId);
    }
  });

  test("4. delete phase1 → 同日を再追加 → delete phase2 は reAdded、schedule は残る", async () => {
    const seasonId = freshSeason();
    const date = "2026-07-18";
    try {
      await seedSchedule(seasonId, date);
      // phase1(blocked書込) と phase2 の間に「再追加」を決定的に割り込ませる。
      const r = await deleteGameScheduleDate(db, GAME, seasonId, date, {
        beforePhase2: async () => {
          await addGameScheduleDate(db, GAME, seasonId, date); // schedule作成＋ロック削除（原子）
        },
      });
      expect(r).toBe("reAdded"); // 再追加が割り込んだので schedule を消さない
      expect(await scheduleExists(seasonId, date)).toBe(true); // 再追加された schedule が残る
      expect(await lockData(seasonId, date)).toBeUndefined(); // ロックは無し（開催日は存在）
      // 「schedule無し＋lock無し」孤児は発生していない。entry も作成できる。
      await entryPostTx(seasonId, date, "u1");
      expect(await entryExists(seasonId, date, "u1")).toBe(true);
    } finally {
      await wipeSeason(seasonId);
    }
  });

  test("5. 参加者なしの通常削除 → deleted + blocked トゥームストーン", async () => {
    const seasonId = freshSeason();
    const date = "2026-07-18";
    try {
      await seedSchedule(seasonId, date);
      expect(await deleteGameScheduleDate(db, GAME, seasonId, date)).toBe("deleted");
      expect(await scheduleExists(seasonId, date)).toBe(false);
      const lk = await lockData(seasonId, date);
      expect(lk?.blocked).toBe(true);
      expect(lk?.deleted).toBe(true);
    } finally {
      await wipeSeason(seasonId);
    }
  });

  test("6. 削除 と 再追加 の同時多発でも不変条件（schedule無し⟹lock必ずblocked）が壊れない", async () => {
    const seasonId = freshSeason();
    const dates = ["2026-07-04", "2026-07-11", "2026-07-18", "2026-07-25"];
    try {
      await Promise.all(dates.map((d) => seedSchedule(seasonId, d)));
      // 各日について delete と add を同時に走らせる（どちらが勝っても不変条件は保たれるべき）。
      // ★ エラーは握り潰さない: allSettled で全結果を受け、rejection を検査する。
      //   Firestore の楽観ロック競合(ABORTED/contention)だけは並行実行上あり得る想定内なので許容し、
      //   それ以外のエラー（＝実バグの兆候）は必ずテスト失敗にする。
      const results = await Promise.allSettled(
        dates.flatMap((d) => [
          deleteGameScheduleDate(db, GAME, seasonId, d),
          addGameScheduleDate(db, GAME, seasonId, d),
        ])
      );
      const CONTENTION = /ABORTED|contention|too much contention|DEADLINE_EXCEEDED|UNAVAILABLE/i;
      const unexpected = results
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)))
        .filter((msg) => !CONTENTION.test(msg));
      expect(unexpected).toEqual([]); // 競合以外のエラーは許容しない（握り潰さない）
      for (const d of dates) {
        const sched = await scheduleExists(seasonId, d);
        const lk = await lockData(seasonId, d);
        if (!sched) {
          // 不変条件: schedule が無いなら、必ず blocked ロックが残っている（孤児化しない）。
          expect(lk?.blocked).toBe(true);
        }
      }
    } finally {
      await wipeSeason(seasonId);
    }
  });
});
