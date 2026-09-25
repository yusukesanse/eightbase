import { isValidMahjongEntryFee } from "@/lib/mahjongSchedule";
import { MAHJONG_ENTRY_FEE } from "@/types/mahjong";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { generateRecurringDates } from "@/lib/scheduleRecurrence";
import { GAME_SCHEDULE_CFG, buildGameScheduleId, deleteGameScheduleDate, addGameScheduleDate, scheduleLockRef, type ScheduleGame } from "@/lib/gameSchedule";
import { isValidHhMm } from "@/lib/scoreboardSeason";
import { todayJst } from "@/lib/date";

export const dynamic = "force-dynamic";

/**
 * 全ゲーム共通の日程API（管理・カレンダーUI用）。開催日を {game}Schedule の doc として管理する。
 *  GET    ?gameCategory=&seasonId=            … 開催日一覧（date 昇順・重複排除）
 *  POST   { gameCategory, seasonId, date }     … 開催日を1件追加（決定的ID・冪等）
 *  POST   { gameCategory, seasonId, bulk:true, startDate?, count? } … 既定日を一括投入
 *  麻雀のPOSTは entryFee 必須。単日・一括とも既存リーグ日には entryFee を書かず、変更はPATCHのみ。
 *  未設定の既存料金は MAHJONG_ENTRY_FEE（3,000円）のまま維持する。
 *  DELETE ?gameCategory=&seasonId=&date=       … 開催日を1件削除（その日の doc を全消し）
 *
 * 麻雀は追加時に同日の休催(mahjongClosedDates)を解除する（土曜を戻したときの整合）。
 */

type Game = ScheduleGame;
const CFG = GAME_SCHEDULE_CFG;
const schedId = buildGameScheduleId;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** YYYY-MM-DD かつ実在日付（UTC基準・繰り上がり/NaN を弾く）。 */
function isRealDate(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00.000Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}
function toGame(v: unknown): Game | null {
  return v === "mahjong" || v === "darts" || v === "billiards" || v === "poker" ? v : null;
}

export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const game = toGame(req.nextUrl.searchParams.get("gameCategory"));
  const seasonId = req.nextUrl.searchParams.get("seasonId");
  if (!game || !seasonId) return NextResponse.json({ error: "gameCategory と seasonId が必要です" }, { status: 400 });

  const db = getDb();
  const snap = await db.collection(CFG[game].col).where("seasonId", "==", seasonId).get();
  const season = (await db.collection("seasons").doc(seasonId).get()).data() as
    | { defaultStartTime?: string; defaultEndTime?: string }
    | undefined;
  const set = new Set<string>();
  // 日付ごとの時刻（既定値と違う日をUIで出し分けるため date -> {startTime,endTime} で返す）。
  const entryFees: Record<string, number> = {};
  const times: Record<string, { startTime: string; endTime: string; overridden: boolean }> = {};
  for (const d of snap.docs) {
    const x = d.data() as { date?: string; type?: string; startTime?: string; endTime?: string; timeOverridden?: boolean; entryFee?: unknown };
    if (x.type && x.type !== "league") continue;
    if (!x.date) continue;
    set.add(x.date);
    if (game === "mahjong") entryFees[x.date] = isValidMahjongEntryFee(x.entryFee) ? x.entryFee : (entryFees[x.date] ?? MAHJONG_ENTRY_FEE);
    times[x.date] = {
      startTime: x.startTime || season?.defaultStartTime || CFG[game].start,
      endTime: x.endTime || season?.defaultEndTime || CFG[game].end,
      overridden: x.timeOverridden === true,
    };
  }
  return NextResponse.json({
    dates: Array.from(set).sort(),
    times,
    ...(game === "mahjong" ? { entryFees } : {}),
    // シーズンの既定時刻（未設定なら種目のコード既定値）
    startTime: season?.defaultStartTime || CFG[game].start,
    endTime: season?.defaultEndTime || CFG[game].end,
  });
}

export async function POST(req: NextRequest) {
  if (!(await checkAdminAuth(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const game = toGame(body?.gameCategory);
  const seasonId: unknown = body?.seasonId;
  if (!game || typeof seasonId !== "string" || !seasonId) {
    return NextResponse.json({ error: "gameCategory と seasonId が必要です" }, { status: 400 });
  }
  if (game === "mahjong" && !isValidMahjongEntryFee(body?.entryFee)) {
    return NextResponse.json({ error: "参加費は1〜100000円の整数で指定してください" }, { status: 400 });
  }
  if (!isValidHhMm(body?.startTime) || !isValidHhMm(body?.endTime)) {
    return NextResponse.json({ error: "時刻は HH:MM 形式で入力してください" }, { status: 400 });
  }
  if (body.startTime >= body.endTime) {
    return NextResponse.json({ error: "終了時刻は開始時刻より後にしてください" }, { status: 400 });
  }
  const db = getDb();
  const cfg = CFG[game];
  const now = new Date().toISOString();
  const makeDoc = (date: string) => ({
    scheduleId: schedId(seasonId, date),
    seasonId,
    date,
    startTime: body.startTime,
    endTime: body.endTime,
    createdAt: now,
    ...(cfg.extra ?? {}),
    ...(game === "mahjong" ? { entryFee: body.entryFee as number } : {}),
  });

  // 一括投入（繰り返し設定）: 曜日 × 間隔（毎週/2週/3週…）× 期間。
  // 期間はシーズン開始日〜指定終了日（シーズン終了日でクランプ）。
  if (body?.bulk === true) {
    const season = (await db.collection("seasons").doc(seasonId).get()).data() as { startDate?: string; endDate?: string } | undefined;
    const weekday = Number(body?.weekday);
    const intervalWeeks = Number(body?.intervalWeeks);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      return NextResponse.json({ error: "weekday は 0（日）〜6（土）で指定してください" }, { status: 400 });
    }
    if (!Number.isInteger(intervalWeeks) || intervalWeeks < 1 || intervalWeeks > 8) {
      return NextResponse.json({ error: "intervalWeeks は 1〜8 で指定してください" }, { status: 400 });
    }
    // 開始日は指定 or シーズン開始日、終了日は指定 or シーズン終了日。シーズン範囲でクランプ。
    let start = isRealDate(body?.startDate) ? body.startDate : season?.startDate;
    let end = isRealDate(body?.endDate) ? body.endDate : season?.endDate;
    if (isRealDate(season?.startDate) && isRealDate(start) && start < season!.startDate!) start = season!.startDate;
    if (isRealDate(season?.endDate) && isRealDate(end) && end > season!.endDate!) end = season!.endDate;
    if (!isRealDate(start) || !isRealDate(end)) {
      return NextResponse.json({ error: "期間（startDate/endDate）が必要です。シーズンの期間を設定してください。" }, { status: 400 });
    }
    const dates = generateRecurringDates({ weekday, intervalWeeks, startDate: start, endDate: end });
    // 1日 = set(schedule)+delete(lock) の2書き込み。Firestore の batch 上限(500 write)を
    // 超えないよう 200日単位（=400 write）で分割コミットする（長期間×毎週でも失敗させない）。
    // 登録済みの日の時刻は明日以降だけ上書きする。参加費は既存値を維持する。
    const existingSnap = await db.collection(cfg.col).where("seasonId", "==", seasonId).get();
    const scheduledDates = new Set(existingSnap.docs.map((d) => d.data().date));
    const today = todayJst();
    // 一括投入は開催日を作る操作。設定済み料金の変更は PATCH だけで行う。
    const existingDates = new Set<string>();
    if (game === "mahjong") for (const d of existingSnap.docs) {
      const x = d.data();
      if ((!x.type || x.type === "league") && x.date) existingDates.add(x.date);
    }
    const CHUNK = 200;
    for (let i = 0; i < dates.length; i += CHUNK) {
      const batch = db.batch();
      for (const date of dates.slice(i, i + CHUNK)) {
        const doc = makeDoc(date);
        if (existingDates.has(date)) delete doc.entryFee;
        if (scheduledDates.has(date) && date <= today) {
          delete doc.startTime;
          delete doc.endTime;
        }
        batch.set(db.collection(cfg.col).doc(schedId(seasonId, date)), doc, { merge: true });
        batch.delete(scheduleLockRef(db, game, seasonId, date)); // 削除トゥームストーンを解除（再追加で受付再開）
      }
      await batch.commit();
    }
    return NextResponse.json({ success: true, added: dates.length, dates });
  }

  // 1件追加。schedule 作成とロック解除を原子化（addGameScheduleDate）。
  const date: unknown = body?.date;
  if (!isRealDate(date)) return NextResponse.json({ error: "date が不正です" }, { status: 400 });
  let entryFee: number | undefined;
  if (game === "mahjong") {
    // 日程と削除ロック解除を同じ transaction に保存する。再追加でも設定済み料金は維持。
    const ref = db.collection(cfg.col).doc(schedId(seasonId, date));
    const lock = scheduleLockRef(db, game, seasonId, date);
    await db.runTransaction(async (tx) => {
      const [, existing] = await Promise.all([
        tx.get(lock),
        tx.get(db.collection(cfg.col).where("seasonId", "==", seasonId).where("date", "==", date)),
      ]);
      const matches = existing.docs.map((d) => d.data()).filter((x) => !x.type || x.type === "league");
      if (matches.length > 0) {
        entryFee = matches.map((x) => x.entryFee).find(isValidMahjongEntryFee) ?? MAHJONG_ENTRY_FEE;
      } else {
        entryFee = body.entryFee;
        tx.set(ref, makeDoc(date), { merge: true });
      }
      tx.delete(lock);
    });
  } else {
    await addGameScheduleDate(db, game, seasonId, date, { startTime: body.startTime, endTime: body.endTime });
  }
  if (game === "mahjong") {
    // 土曜を開催に戻したときに旧「休催」doc が残っていると弾かれるため解除（best-effort）。
    await db.collection("mahjongClosedDates").doc(date).delete().catch(() => {});
  }
  return NextResponse.json({ success: true, date, ...(game === "mahjong" ? { entryFee } : {}) }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  if (!(await checkAdminAuth(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const game = toGame(sp.get("gameCategory"));
  const seasonId = sp.get("seasonId");
  if (!game || !seasonId) {
    return NextResponse.json({ error: "gameCategory / seasonId が必要です" }, { status: 400 });
  }
  const db = getDb();

  // 一括削除: ?all=1（全期間）または ?from=&to=（期間）。日単位で安全削除を順次実行（tx上限回避）。
  const all = sp.get("all") === "1";
  const from = sp.get("from");
  const to = sp.get("to");
  if (all || (isRealDate(from) && isRealDate(to))) {
    const schedSnap = await db.collection(CFG[game].col).where("seasonId", "==", seasonId).get();
    const candidates = Array.from(
      new Set(schedSnap.docs.map((d) => (d.data() as { date?: string }).date).filter((x): x is string => !!x))
    )
      .filter((dt) => all || (dt >= from! && dt <= to!))
      .sort();
    // 日単位で安全削除を順次実行。途中失敗（ロック解除失敗等）は failed に記録して部分成功を可視化（#9）。
    let deleted = 0;
    const skipped: string[] = []; // 参加者あり
    const reAdded: string[] = []; // 削除中に再追加された（削除しない）
    const failed: { date: string; error: string }[] = [];
    for (const dt of candidates) {
      try {
        const r = await deleteGameScheduleDate(db, game, seasonId, dt);
        if (r === "deleted") deleted += 1;
        else if (r === "reAdded") reAdded.push(dt);
        else skipped.push(dt);
      } catch (e) {
        failed.push({ date: dt, error: e instanceof Error ? e.message : String(e) });
        console.error(`[admin/games/schedule] bulk delete failed for ${dt}:`, e);
      }
    }
    return NextResponse.json({ success: failed.length === 0, deleted, skipped, reAdded, failed });
  }

  // 単日削除（同じ安全関数を使用）。
  const date = sp.get("date");
  if (!isRealDate(date)) return NextResponse.json({ error: "date が不正です" }, { status: 400 });
  const r = await deleteGameScheduleDate(db, game, seasonId, date);
  if (r === "skipped") return NextResponse.json({ error: "参加者がいるため削除できません" }, { status: 409 });
  // reAdded: 削除処理中に同日が再追加された → 削除せず成功（開催日は存在）。
  return NextResponse.json({ success: true, result: r });
}

/**
 * PATCH { gameCategory, seasonId, date, startTime?, endTime? }
 * 開催日ごとの時刻を上書きする（イレギュラー対応）。
 * 既定値はシーズン編集の「開催の既定時刻」。ここでの変更はその日だけに効く。
 */
export async function PATCH(req: NextRequest) {
  if (!(await checkAdminAuth(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const game = toGame(body?.gameCategory);
  const seasonId: unknown = body?.seasonId;
  const date: unknown = body?.date;
  if (!game || typeof seasonId !== "string" || !seasonId) {
    return NextResponse.json({ error: "gameCategory と seasonId が必要です" }, { status: 400 });
  }
  if (!isRealDate(date)) return NextResponse.json({ error: "date が不正です" }, { status: 400 });

  const updates: { startTime?: string; endTime?: string; entryFee?: number } = {};
  if (game === "mahjong" && body?.entryFee !== undefined) {
    if (!isValidMahjongEntryFee(body.entryFee)) {
      return NextResponse.json({ error: "参加費は1〜100000円の整数で指定してください" }, { status: 400 });
    }
    updates.entryFee = body.entryFee;
  }
  for (const key of ["startTime", "endTime"] as const) {
    if (body?.[key] === undefined) continue;
    if (!isValidHhMm(body[key])) {
      return NextResponse.json({ error: "時刻は HH:MM 形式で入力してください" }, { status: 400 });
    }
    updates[key] = body[key];
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: game === "mahjong" ? "時刻または参加費を指定してください" : "startTime か endTime を指定してください" }, { status: 400 });
  }
  if (updates.startTime && updates.endTime && updates.startTime >= updates.endTime) {
    return NextResponse.json({ error: "終了時刻は開始時刻より後にしてください" }, { status: 400 });
  }

  const db = getDb();
  const ref = db.collection(CFG[game].col).doc(schedId(seasonId, date));
  // 麻雀は旧自動採番IDも存在する。同日が重複していても料金を揃える。
  const matches = game === "mahjong"
    ? (await db.collection(CFG[game].col).where("seasonId", "==", seasonId).where("date", "==", date).get()).docs
        .filter((d) => !d.data().type || d.data().type === "league")
    : [];
  const snap = game === "mahjong" ? (matches.find((d) => d.id === ref.id) ?? matches[0]) : await ref.get();
  if (!snap?.exists) return NextResponse.json({ error: "開催日が見つかりません" }, { status: 404 });
  // 片方だけ変更された場合も前後関係を検証する（保存済みの値と突き合わせ）。
  const cur = snap.data() as { startTime?: string; endTime?: string };
  const nextStart = updates.startTime ?? cur.startTime;
  const nextEnd = updates.endTime ?? cur.endTime;
  const changesTime = updates.startTime !== undefined || updates.endTime !== undefined;
  if (changesTime && nextStart && nextEnd && nextStart >= nextEnd) {
    return NextResponse.json({ error: "終了時刻は開始時刻より後にしてください" }, { status: 400 });
  }

  // 個別変更した日として印を付ける（シーズン既定を変えても上書きされないようにする）。
  // resetToDefault=true なら印を外し、以後は既定の変更に追随する。
  const resetToDefault = body?.resetToDefault === true;
  const fields = { ...updates, ...(changesTime ? { timeOverridden: !resetToDefault } : {}), updatedAt: new Date().toISOString() };
  if (game === "mahjong") {
    const batch = db.batch();
    for (const d of matches) batch.set(db.collection(CFG[game].col).doc(d.id), fields, { merge: true });
    await batch.commit();
  } else {
    await ref.set(fields, { merge: true });
  }
  return NextResponse.json({ success: true, date, startTime: nextStart, endTime: nextEnd, ...(game === "mahjong" ? { entryFee: updates.entryFee } : {}) });
}
