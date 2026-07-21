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

beforeAll(() => {
  const projectId = process.env.GCLOUD_PROJECT || "eightbase-emulator-test";
  app = getApps().length ? getApps()[0] : initializeApp({ projectId });
  db = getFirestore(app);
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
 * @param afterRead 1回目の読み取り直後に一度だけ実行するフック（並行割り込みの注入用）。
 */
async function entryPostTx(
  seasonId: string,
  date: string,
  uid: string,
  afterRead?: () => Promise<void>
): Promise<{ attempts: number }> {
  let attempts = 0;
  await db.runTransaction(async (tx) => {
    attempts += 1;
    const ref = db.collection(ENTRY_COL).doc(`${seasonId}_${date}_${uid}`);
    const entrySnap = await tx.get(ref);
    const blocked = await isScheduleDateBlockedInTx(tx, db, GAME, seasonId, date);
    // 1回目の読み取り直後だけ割り込みを注入（delete phase1 を先に commit させる）。
    if (attempts === 1 && afterRead) {
      const hook = afterRead;
      afterRead = undefined;
      await hook();
    }
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

  test("3. entry が lock を読んだ後に削除が commit → entry tx が再試行され拒否", async () => {
    const seasonId = freshSeason();
    const date = "2026-07-18";
    try {
      await seedSchedule(seasonId, date);
      // entry tx: 1回目の読み取り（lock=未blocked）直後に、削除を完了させてから commit を試みる。
      // → 読んだ lock doc が変わっているため Firestore が abort → 再試行 → blocked を読み NOT_SCHEDULED。
      let deleteResult: string | undefined;
      await expect(
        entryPostTx(seasonId, date, "u1", async () => {
          deleteResult = await deleteGameScheduleDate(db, GAME, seasonId, date);
        })
      ).rejects.toThrow("NOT_SCHEDULED");
      expect(deleteResult).toBe("deleted"); // 割り込み中に削除は完了
      expect(await entryExists(seasonId, date, "u1")).toBe(false); // entry は作られない
      expect(await scheduleExists(seasonId, date)).toBe(false);
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
      await Promise.all(
        dates.flatMap((d) => [
          deleteGameScheduleDate(db, GAME, seasonId, d).catch(() => "err"),
          addGameScheduleDate(db, GAME, seasonId, d).catch(() => undefined),
        ])
      );
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
