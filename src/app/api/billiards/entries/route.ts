import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser, requireGameUserWithRole } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { gamePaymentRequired } from "@/lib/roles";
import { isProduction } from "@/lib/env";
import { isScheduledBilliardsDate, isBilliardsCancelledDate } from "@/lib/billiardsSchedule";
import { buildBilliardsEntryId, isValidBilliardsDate } from "@/lib/billiardsEntryValidation";
import { isScheduleDateBlockedInTx } from "@/lib/gameSchedule";
import { deriveStatus } from "@/lib/billiardsEntryStatus";
import { BILLIARDS_MAX_ENTRIES_PER_DATE, type BilliardsEntry } from "@/types/billiards";

export const dynamic = "force-dynamic";

/**
 * ビリヤードリーグ 参加表明 API（ダーツ entries を流用）。
 * 開催日の実在は `billiardsSchedule`（管理登録＝第2/第4土曜）で確認する。定員8名・月1回・staff免除。
 * GM「ゲーム開始」後（billiardsDayState.entryClosedAt）は受付を締め切る（POST tx 内で二重チェック）。
 */

async function releaseMonthlyLock(
  db: FirebaseFirestore.Firestore,
  seasonId: string,
  userId: string,
  eventDate: string
) {
  const lockRef = db.collection("billiardsMonthlyLocks").doc(`${seasonId}_${userId}_${eventDate.slice(0, 7)}`);
  const s = await lockRef.get();
  if (s.exists && s.data()?.eventDate === eventDate) await lockRef.delete();
}

/** GET /api/billiards/entries?eventDate=YYYY-MM-DD ／ ?mine=1 */
export async function GET(req: NextRequest) {
  try {
    const [auth, season] = await Promise.all([requireGameUserWithRole(req), getActiveSeason("billiards")]);
    if (!auth) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    const { lineUserId: userId, role } = auth;
    const paymentRequired = gamePaymentRequired(role);

    if (req.nextUrl.searchParams.get("mine") === "1") {
      if (!season) return NextResponse.json({ entries: [], paymentRequired });
      const snap = await getDb()
        .collection("billiardsEntries")
        .where("seasonId", "==", season.seasonId)
        .where("lineUserId", "==", userId)
        .get();
      const my = snap.docs
        .map((d) => d.data() as BilliardsEntry)
        .map((e) => ({ eventDate: e.eventDate, paymentStatus: e.paymentStatus ?? null }));
      return NextResponse.json({ entries: my, paymentRequired });
    }

    const eventDate = req.nextUrl.searchParams.get("eventDate");
    if (!isValidBilliardsDate(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }
    if (!season) {
      return NextResponse.json({ entries: [], entered: false, me: { entered: false, paymentRequired, paymentStatus: null } });
    }

    const snap = await getDb()
      .collection("billiardsEntries")
      .where("seasonId", "==", season.seasonId)
      .where("eventDate", "==", eventDate)
      .get();
    const rawEntries = snap.docs
      .map((d) => ({ ...(d.data() as BilliardsEntry), entryId: d.id }))
      .sort((a, b) => a.enteredAt.localeCompare(b.enteredAt));

    const myEntry = rawEntries.find((e) => e.lineUserId === userId);
    const full = rawEntries.length >= BILLIARDS_MAX_ENTRIES_PER_DATE;
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
      capacity: BILLIARDS_MAX_ENTRIES_PER_DATE,
      count: rawEntries.length,
      me: { entered: !!myEntry, paymentRequired, paymentStatus: myEntry?.paymentStatus ?? null },
    });
  } catch (error) {
    console.error("[billiards/entries] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

/** POST /api/billiards/entries { eventDate } — 参加表明（自分）。 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireGameUserWithRole(req);
    if (!auth) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    const userId = auth.lineUserId;
    const status: "reserved" | "paid" = gamePaymentRequired(auth.role) ? "reserved" : "paid";

    const body = await req.json().catch(() => null);
    const eventDate: unknown = body?.eventDate;
    if (!isValidBilliardsDate(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }

    const season = await getActiveSeason("billiards");
    if (!season) return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });

    if (!(await isScheduledBilliardsDate(season.seasonId, eventDate))) {
      return NextResponse.json({ error: "開催日ではありません" }, { status: 400 });
    }
    if (await isBilliardsCancelledDate(eventDate)) {
      return NextResponse.json({ error: "この開催日は中止されました" }, { status: 409 });
    }

    const db = getDb();
    const entryId = buildBilliardsEntryId(season.seasonId, eventDate, userId);
    const ref = db.collection("billiardsEntries").doc(entryId);
    const userDoc = await db.collection("users").doc(userId).get();
    const u = userDoc.data() || {};
    const entry: Omit<BilliardsEntry, "entryId"> = {
      seasonId: season.seasonId,
      eventDate,
      lineUserId: userId,
      displayName: u.displayName || "ユーザー",
      pictureUrl: u.pictureUrl || "",
      enteredAt: new Date().toISOString(),
      status,
    };

    const ym = eventDate.slice(0, 7);
    const lockRef = db.collection("billiardsMonthlyLocks").doc(`${season.seasonId}_${userId}_${ym}`);
    const dayRef = db.collection("billiardsDayState").doc(`${season.seasonId}_${eventDate}`);
    try {
      await db.runTransaction(async (tx) => {
        const daySnap = await tx.get(dayRef);
        if (daySnap.data()?.entryClosedAt) throw new Error("ENTRY_CLOSED");
        const lockSnap = await tx.get(lockRef);
        const entrySnap = await tx.get(ref);
        if (!entrySnap.exists) {
          // 開催日の削除（scheduleLocks の blocked）と直列化＝ID指定の読み取りで競合検知。
          if (await isScheduleDateBlockedInTx(tx, db, "billiards", season.seasonId, eventDate)) throw new Error("NOT_SCHEDULED");
          const dateSnap = await tx.get(
            db.collection("billiardsEntries").where("seasonId", "==", season.seasonId).where("eventDate", "==", eventDate)
          );
          if (dateSnap.size >= BILLIARDS_MAX_ENTRIES_PER_DATE) throw new Error("FULL");
        }
        if (!entrySnap.exists && lockSnap.exists) {
          const lockedDate = lockSnap.data()?.eventDate as string | undefined;
          if (lockedDate && lockedDate !== eventDate) {
            const otherRef = db.collection("billiardsEntries").doc(buildBilliardsEntryId(season.seasonId, lockedDate, userId));
            const otherSnap = await tx.get(otherRef);
            if (otherSnap.exists) throw new Error("MONTHLY_LIMIT");
          }
        }
        tx.set(lockRef, { seasonId: season.seasonId, lineUserId: userId, ym, eventDate, updatedAt: new Date().toISOString() });
        tx.set(ref, entry, { merge: true });
      });
    } catch (e) {
      if (e instanceof Error && e.message === "ENTRY_CLOSED") {
        return NextResponse.json({ error: "受付は締め切られました" }, { status: 409 });
      }
      if (e instanceof Error && e.message === "NOT_SCHEDULED") {
        return NextResponse.json({ error: "開催日ではありません" }, { status: 400 });
      }
      if (e instanceof Error && e.message === "MONTHLY_LIMIT") {
        return NextResponse.json({ error: "参加は同じ月に1回までです（別の月をお選びください）", monthlyLimit: true }, { status: 409 });
      }
      if (e instanceof Error && e.message === "FULL") {
        return NextResponse.json({ error: `この開催日は満員です（定員${BILLIARDS_MAX_ENTRIES_PER_DATE}名）。`, full: true }, { status: 409 });
      }
      throw e;
    }
    return NextResponse.json({ entry: { ...entry, entryId } }, { status: 201 });
  } catch (error) {
    console.error("[billiards/entries] POST error:", error);
    return NextResponse.json({ error: "参加表明に失敗しました" }, { status: 500 });
  }
}

/** DELETE /api/billiards/entries?eventDate=YYYY-MM-DD — 参加表明の取消（自分）。 */
export async function DELETE(req: NextRequest) {
  try {
    const userId = await requireGameUser(req);
    if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

    const eventDate = req.nextUrl.searchParams.get("eventDate");
    if (!isValidBilliardsDate(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }
    const season = await getActiveSeason("billiards");
    if (!season) return NextResponse.json({ success: true });

    const db = getDb();
    const entryId = buildBilliardsEntryId(season.seasonId, eventDate, userId);
    const ref = db.collection("billiardsEntries").doc(entryId);
    const snap = await ref.get();

    // DEV-ONLY: 非本番は支払い状態に関わらず取消可（デモで支払いUIを繰り返し検証できるように）。
    if (!isProduction()) {
      if (snap.exists) await ref.delete();
      await releaseMonthlyLock(db, season.seasonId, userId, eventDate);
      return NextResponse.json({ success: true });
    }
    const st = snap.exists ? (snap.data() as BilliardsEntry).paymentStatus : undefined;
    if (st === "paid" || st === "cancelRequested") {
      return NextResponse.json(
        { error: "PAID_LOCKED", message: "参加費お支払い済みのため取り消せません。キャンセルは「支払いをキャンセル」から依頼してください。" },
        { status: 409 }
      );
    }
    if (snap.exists) await ref.delete();
    await releaseMonthlyLock(db, season.seasonId, userId, eventDate);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[billiards/entries] DELETE error:", error);
    return NextResponse.json({ error: "取消に失敗しました" }, { status: 500 });
  }
}
