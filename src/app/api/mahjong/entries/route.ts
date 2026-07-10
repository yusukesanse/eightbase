import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { getDayState, isEntryClosed } from "@/lib/mahjongDay";
import { requireGameUser, requireGameUserWithRole } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { mahjongPaymentRequired } from "@/lib/roles";
import { isProduction } from "@/lib/env";
import {
  buildMahjongEntryId,
  isSaturdayMahjongDate,
  isValidMahjongDate,
} from "@/lib/mahjongEntryValidation";
import type { MahjongEntry } from "@/types";

export const dynamic = "force-dynamic";

/** 月ロックを解放（そのロックが当該開催日を指しているときのみ）。参加取消で枠を戻す。 */
async function releaseMonthlyLock(
  db: FirebaseFirestore.Firestore,
  seasonId: string,
  userId: string,
  eventDate: string
) {
  const lockRef = db.collection("mahjongMonthlyLocks").doc(`${seasonId}_${userId}_${eventDate.slice(0, 7)}`);
  const s = await lockRef.get();
  if (s.exists && s.data()?.eventDate === eventDate) await lockRef.delete();
}

/**
 * GET /api/mahjong/entries?eventDate=YYYY-MM-DD
 * 指定開催日の参加表明者一覧（アクティブシーズン）
 */
export async function GET(req: NextRequest) {
  try {
    // 認証とアクティブシーズン取得は独立＝並列化。
    const [auth, season] = await Promise.all([
      requireGameUserWithRole(req),
      getActiveSeason(),
    ]);
    if (!auth) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }
    const { lineUserId: userId, role } = auth;
    const paymentRequired = mahjongPaymentRequired(role);

    // mine=1: 自分の参加一覧（開催日＋支払い状態）。カレンダー参加UI・月1回制御に使う。
    if (req.nextUrl.searchParams.get("mine") === "1") {
      if (!season) return NextResponse.json({ entries: [], paymentRequired });
      const snap = await getDb()
        .collection("mahjongEntries")
        .where("seasonId", "==", season.seasonId)
        .get();
      const my = snap.docs
        .map((d) => d.data() as MahjongEntry)
        .filter((e) => e.lineUserId === userId)
        .map((e) => ({ eventDate: e.eventDate, paymentStatus: e.paymentStatus ?? null }));
      return NextResponse.json({ entries: my, paymentRequired });
    }

    const eventDate = req.nextUrl.searchParams.get("eventDate");
    if (!isValidMahjongDate(eventDate)) {
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
      .collection("mahjongEntries")
      .where("seasonId", "==", season.seasonId)
      .get();

    const rawEntries = snap.docs
      .map((d) => ({ ...(d.data() as MahjongEntry), entryId: d.id }))
      .filter((e) => e.eventDate === eventDate)
      .sort((a, b) => a.enteredAt.localeCompare(b.enteredAt));

    const myEntry = rawEntries.find((e) => e.lineUserId === userId);

    // 一覧は公開DTOのみ（内部lineUserId/entryId・決済照合情報は返さない）。
    // 他人へは表示名・アイコン・仮予約/確定だけ。自分の決済状態は下の me で返す。
    const entries = rawEntries.map((e) => ({
      displayName: e.displayName,
      pictureUrl: e.pictureUrl ?? "",
      status: e.status ?? (e.paymentStatus === "paid" ? "paid" : "reserved"),
      isMe: e.lineUserId === userId,
    }));

    return NextResponse.json({
      entries,
      entered: !!myEntry,
      me: {
        entered: !!myEntry,
        paymentRequired,
        paymentStatus: myEntry?.paymentStatus ?? null,
      },
    });
  } catch (error) {
    console.error("[mahjong/entries] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

/**
 * POST /api/mahjong/entries
 * 開催日への参加表明（自分）
 * body: { eventDate: string }
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireGameUserWithRole(req);
    if (!auth) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }
    const userId = auth.lineUserId;
    // 支払い必須(member/guest)は仮予約、免除(staff)は参加時点で確定。
    const status: "reserved" | "paid" = mahjongPaymentRequired(auth.role) ? "reserved" : "paid";

    const body = await req.json().catch(() => null);
    const eventDate: unknown = body?.eventDate;
    if (!isValidMahjongDate(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }
    if (!isSaturdayMahjongDate(eventDate)) {
      return NextResponse.json({ error: "開催日は土曜日のみです" }, { status: 400 });
    }
    // 休催日（管理者が非活性化した土曜）は参加不可
    const closed = await getDb().collection("mahjongClosedDates").doc(eventDate).get();
    if (closed.exists) {
      return NextResponse.json({ error: "この開催日は休催です" }, { status: 409 });
    }

    const season = await getActiveSeason();
    if (!season) {
      return NextResponse.json(
        { error: "アクティブなシーズンがありません" },
        { status: 400 }
      );
    }

    // GM が「ゲーム開始」を押した開催日は受付終了（参加表明も締切）。
    if (isEntryClosed(await getDayState(season.seasonId, eventDate))) {
      return NextResponse.json(
        { error: "CLOSED", message: "受付を終了しました（ゲームが開始されています）。" },
        { status: 409 }
      );
    }

    const db = getDb();
    // 決定的な ID で重複表明を防ぐ
    const entryId = buildMahjongEntryId(season.seasonId, eventDate, userId);
    const ref = db.collection("mahjongEntries").doc(entryId);

    const userDoc = await db.collection("users").doc(userId).get();
    const u = userDoc.data() || {};

    const entry: Omit<MahjongEntry, "entryId"> = {
      seasonId: season.seasonId,
      eventDate,
      lineUserId: userId,
      displayName: u.displayName || "ユーザー",
      pictureUrl: u.pictureUrl || "",
      enteredAt: new Date().toISOString(),
      status,
    };

    // 参加は「1ユーザー月1回」。月ロックdoc(mahjongMonthlyLocks)を transaction 内で
    // 読んで原子的に確保する（同一docへの並行書き込みは競合検知＝phantomすり抜けを防ぐ）。
    // 同日は冪等（再表明可）、別日・同月は 409、別月は許可。stale lockは自己回復。
    const ym = eventDate.slice(0, 7);
    const lockRef = db.collection("mahjongMonthlyLocks").doc(`${season.seasonId}_${userId}_${ym}`);
    try {
      await db.runTransaction(async (tx) => {
        const lockSnap = await tx.get(lockRef);
        const entrySnap = await tx.get(ref);
        if (!entrySnap.exists && lockSnap.exists) {
          const lockedDate = lockSnap.data()?.eventDate as string | undefined;
          if (lockedDate && lockedDate !== eventDate) {
            // 別日ロックだが、その予約が実在するときだけ拒否（無ければstale＝上書き許可）。
            const otherRef = db
              .collection("mahjongEntries")
              .doc(buildMahjongEntryId(season.seasonId, lockedDate, userId));
            const otherSnap = await tx.get(otherRef);
            if (otherSnap.exists) throw new Error("MONTHLY_LIMIT");
          }
        }
        tx.set(lockRef, { seasonId: season.seasonId, lineUserId: userId, ym, eventDate, updatedAt: new Date().toISOString() });
        tx.set(ref, entry, { merge: true });
      });
    } catch (e) {
      if (e instanceof Error && e.message === "MONTHLY_LIMIT") {
        return NextResponse.json(
          { error: "参加は同じ月に1回までです（別の月をお選びください）", monthlyLimit: true },
          { status: 409 }
        );
      }
      throw e;
    }
    return NextResponse.json({ entry: { ...entry, entryId } }, { status: 201 });
  } catch (error) {
    console.error("[mahjong/entries] POST error:", error);
    return NextResponse.json({ error: "参加表明に失敗しました" }, { status: 500 });
  }
}

/**
 * DELETE /api/mahjong/entries?eventDate=YYYY-MM-DD
 * 参加表明の取消（自分）
 */
export async function DELETE(req: NextRequest) {
  try {
    const userId = await requireGameUser(req);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const eventDate = req.nextUrl.searchParams.get("eventDate");
    if (!isValidMahjongDate(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }

    const season = await getActiveSeason();
    if (!season) return NextResponse.json({ success: true });

    const db = getDb();
    const entryId = buildMahjongEntryId(season.seasonId, eventDate, userId);
    const ref = db.collection("mahjongEntries").doc(entryId);
    const snap = await ref.get();
    // DEV-ONLY（develop 専用 / main へ入れない）: 非本番は支払い状態に関わらず取消可。
    // デモで「参加→支払う→キャンセル→返金対応中」から抜け、支払いUIを繰り返し検証できるように。
    if (!isProduction()) {
      if (snap.exists) await ref.delete();
      await releaseMonthlyLock(db, season.seasonId, userId, eventDate);
      return NextResponse.json({ success: true });
    }
    // 支払い済み/返金対応中の参加は取消不可（参加費レコードの消失・返金漏れを防ぐ）。
    // 参加費のキャンセルは /api/mahjong/entries/cancel-payment（管理者手動返金）へ誘導。
    const status = snap.exists ? (snap.data() as MahjongEntry).paymentStatus : undefined;
    if (status === "paid" || status === "cancelRequested") {
      return NextResponse.json(
        {
          error: "PAID_LOCKED",
          message: "参加費お支払い済みのため取り消せません。キャンセルは「支払いをキャンセル」から依頼してください。",
        },
        { status: 409 }
      );
    }
    // 未決済（仮予約）はいつでも取消可（返金なし）。取消後は別日を選べる。
    await ref.delete();
    await releaseMonthlyLock(db, season.seasonId, userId, eventDate);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[mahjong/entries] DELETE error:", error);
    return NextResponse.json({ error: "取消に失敗しました" }, { status: 500 });
  }
}
