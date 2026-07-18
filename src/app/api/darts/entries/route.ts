import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser, requireGameUserWithRole } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { gamePaymentRequired } from "@/lib/roles";
import { isProduction } from "@/lib/env";
import { isScheduledDartsDate, isDartsCancelledDate } from "@/lib/dartsSchedule";
import { buildDartsEntryId, isValidDartsDate } from "@/lib/dartsEntryValidation";
import { deriveStatus } from "@/lib/dartsEntryStatus";
import { DARTS_MAX_ENTRIES_PER_DATE, type DartsEntry } from "@/types/darts";

export const dynamic = "force-dynamic";

/**
 * ダーツリーグ 参加表明 API（麻雀 entries を流用）。
 * 開催日の実在は `dartsSchedule`（管理登録＝隔週木曜）で確認する。定員8名・月1回・staff免除。
 *
 * 注: GM「ゲーム開始」による受付締切は Phase 3（dartsDayState）で追加する（TODO）。
 */

/** 月ロックを解放（そのロックが当該開催日を指しているときのみ）。 */
async function releaseMonthlyLock(
  db: FirebaseFirestore.Firestore,
  seasonId: string,
  userId: string,
  eventDate: string
) {
  const lockRef = db.collection("dartsMonthlyLocks").doc(`${seasonId}_${userId}_${eventDate.slice(0, 7)}`);
  const s = await lockRef.get();
  if (s.exists && s.data()?.eventDate === eventDate) await lockRef.delete();
}

/** GET /api/darts/entries?eventDate=YYYY-MM-DD ／ ?mine=1 */
export async function GET(req: NextRequest) {
  try {
    const [auth, season] = await Promise.all([
      requireGameUserWithRole(req),
      getActiveSeason("darts"),
    ]);
    if (!auth) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    const { lineUserId: userId, role } = auth;
    const paymentRequired = gamePaymentRequired(role);

    // mine=1: 自分の参加一覧（開催日＋支払い状態）。カレンダー・月1回制御用。
    if (req.nextUrl.searchParams.get("mine") === "1") {
      if (!season) return NextResponse.json({ entries: [], paymentRequired });
      const snap = await getDb()
        .collection("dartsEntries")
        .where("seasonId", "==", season.seasonId)
        .where("lineUserId", "==", userId)
        .get();
      const my = snap.docs
        .map((d) => d.data() as DartsEntry)
        .map((e) => ({ eventDate: e.eventDate, paymentStatus: e.paymentStatus ?? null }));
      return NextResponse.json({ entries: my, paymentRequired });
    }

    const eventDate = req.nextUrl.searchParams.get("eventDate");
    if (!isValidDartsDate(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }
    if (!season) {
      return NextResponse.json({
        entries: [],
        entered: false,
        me: { entered: false, paymentRequired, paymentStatus: null },
      });
    }

    const snap = await getDb()
      .collection("dartsEntries")
      .where("seasonId", "==", season.seasonId)
      .where("eventDate", "==", eventDate)
      .get();

    const rawEntries = snap.docs
      .map((d) => ({ ...(d.data() as DartsEntry), entryId: d.id }))
      .sort((a, b) => a.enteredAt.localeCompare(b.enteredAt));

    const myEntry = rawEntries.find((e) => e.lineUserId === userId);
    const full = rawEntries.length >= DARTS_MAX_ENTRIES_PER_DATE;

    // 公開DTO（内部lineUserId/entryId・決済照合情報は返さない）。
    const entries = rawEntries.map((e) => {
      const ds = deriveStatus(e);
      const paid = ds !== "reserved" && ds !== "refunded";
      return {
        displayName: e.displayName,
        pictureUrl: e.pictureUrl ?? "",
        status: e.status ?? (e.paymentStatus === "paid" ? "paid" : "reserved"),
        displayStatus: paid ? ("paid" as const) : ("joined_unpaid" as const),
        isMe: e.lineUserId === userId,
      };
    });

    return NextResponse.json({
      entries,
      entered: !!myEntry,
      full,
      capacity: DARTS_MAX_ENTRIES_PER_DATE,
      count: rawEntries.length,
      me: {
        entered: !!myEntry,
        paymentRequired,
        paymentStatus: myEntry?.paymentStatus ?? null,
      },
    });
  } catch (error) {
    console.error("[darts/entries] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

/** POST /api/darts/entries { eventDate } — 参加表明（自分）。 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireGameUserWithRole(req);
    if (!auth) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    const userId = auth.lineUserId;
    // staff は参加時点で paid（免除）。会員/ゲストは reserved → Square 決済で paid。
    const status: "reserved" | "paid" = gamePaymentRequired(auth.role) ? "reserved" : "paid";

    const body = await req.json().catch(() => null);
    const eventDate: unknown = body?.eventDate;
    if (!isValidDartsDate(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }

    const season = await getActiveSeason("darts");
    if (!season) {
      return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });
    }

    // 開催日は dartsSchedule に登録済みのものだけ（隔週木曜・管理登録）。中止(流会)日は不可。
    if (!(await isScheduledDartsDate(season.seasonId, eventDate))) {
      return NextResponse.json({ error: "開催日ではありません" }, { status: 400 });
    }
    if (await isDartsCancelledDate(eventDate)) {
      return NextResponse.json({ error: "この開催日は中止されました" }, { status: 409 });
    }

    // TODO(Phase 3): GM「ゲーム開始」で受付締切（dartsDayState.entryClosedAt）を確認する。

    const db = getDb();
    const entryId = buildDartsEntryId(season.seasonId, eventDate, userId);
    const ref = db.collection("dartsEntries").doc(entryId);

    const userDoc = await db.collection("users").doc(userId).get();
    const u = userDoc.data() || {};

    const entry: Omit<DartsEntry, "entryId"> = {
      seasonId: season.seasonId,
      eventDate,
      lineUserId: userId,
      displayName: u.displayName || "ユーザー",
      pictureUrl: u.pictureUrl || "",
      enteredAt: new Date().toISOString(),
      status,
    };

    // 月1回ロック＋定員8をトランザクションで原子確保（麻雀と同じ）。
    const ym = eventDate.slice(0, 7);
    const lockRef = db.collection("dartsMonthlyLocks").doc(`${season.seasonId}_${userId}_${ym}`);
    try {
      await db.runTransaction(async (tx) => {
        const lockSnap = await tx.get(lockRef);
        const entrySnap = await tx.get(ref);
        if (!entrySnap.exists) {
          const dateSnap = await tx.get(
            db
              .collection("dartsEntries")
              .where("seasonId", "==", season.seasonId)
              .where("eventDate", "==", eventDate)
          );
          if (dateSnap.size >= DARTS_MAX_ENTRIES_PER_DATE) throw new Error("FULL");
        }
        if (!entrySnap.exists && lockSnap.exists) {
          const lockedDate = lockSnap.data()?.eventDate as string | undefined;
          if (lockedDate && lockedDate !== eventDate) {
            const otherRef = db
              .collection("dartsEntries")
              .doc(buildDartsEntryId(season.seasonId, lockedDate, userId));
            const otherSnap = await tx.get(otherRef);
            if (otherSnap.exists) throw new Error("MONTHLY_LIMIT");
          }
        }
        tx.set(lockRef, {
          seasonId: season.seasonId,
          lineUserId: userId,
          ym,
          eventDate,
          updatedAt: new Date().toISOString(),
        });
        tx.set(ref, entry, { merge: true });
      });
    } catch (e) {
      if (e instanceof Error && e.message === "MONTHLY_LIMIT") {
        return NextResponse.json(
          { error: "参加は同じ月に1回までです（別の月をお選びください）", monthlyLimit: true },
          { status: 409 }
        );
      }
      if (e instanceof Error && e.message === "FULL") {
        return NextResponse.json(
          {
            error: `この開催日は満員です（定員${DARTS_MAX_ENTRIES_PER_DATE}名）。別の開催日をお選びください。`,
            full: true,
          },
          { status: 409 }
        );
      }
      throw e;
    }
    return NextResponse.json({ entry: { ...entry, entryId } }, { status: 201 });
  } catch (error) {
    console.error("[darts/entries] POST error:", error);
    return NextResponse.json({ error: "参加表明に失敗しました" }, { status: 500 });
  }
}

/** DELETE /api/darts/entries?eventDate=YYYY-MM-DD — 参加表明の取消（自分）。 */
export async function DELETE(req: NextRequest) {
  try {
    const userId = await requireGameUser(req);
    if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

    const eventDate = req.nextUrl.searchParams.get("eventDate");
    if (!isValidDartsDate(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }

    const season = await getActiveSeason("darts");
    if (!season) return NextResponse.json({ success: true });

    const db = getDb();
    const entryId = buildDartsEntryId(season.seasonId, eventDate, userId);
    const ref = db.collection("dartsEntries").doc(entryId);
    const snap = await ref.get();

    // DEV-ONLY: 非本番は支払い状態に関わらず取消可（デモで支払いUIを繰り返し検証できるように）。
    if (!isProduction()) {
      if (snap.exists) await ref.delete();
      await releaseMonthlyLock(db, season.seasonId, userId, eventDate);
      return NextResponse.json({ success: true });
    }
    // 支払い済み/返金対応中は取消不可（cancel-payment＝管理者手動返金へ誘導）。
    const st = snap.exists ? (snap.data() as DartsEntry).paymentStatus : undefined;
    if (st === "paid" || st === "cancelRequested") {
      return NextResponse.json(
        {
          error: "PAID_LOCKED",
          message: "参加費お支払い済みのため取り消せません。キャンセルは「支払いをキャンセル」から依頼してください。",
        },
        { status: 409 }
      );
    }
    await ref.delete();
    await releaseMonthlyLock(db, season.seasonId, userId, eventDate);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[darts/entries] DELETE error:", error);
    return NextResponse.json({ error: "取消に失敗しました" }, { status: 500 });
  }
}
