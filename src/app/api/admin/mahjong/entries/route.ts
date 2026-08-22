import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getActiveSeason } from "@/lib/mahjong";
import { buildMahjongEntryId } from "@/lib/mahjongEntryValidation";
import { deriveStatus } from "@/lib/mahjongEntryStatus";
import { writeAuditLog } from "@/lib/auditLog";
import { MAHJONG_ENTRY_FEE, type MahjongEntry } from "@/types";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/admin/mahjong/entries?eventDate=YYYY-MM-DD
 * 指定開催日の参加表明者一覧（管理者）
 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const eventDate = req.nextUrl.searchParams.get("eventDate");
    if (!eventDate || !DATE_RE.test(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }
    const season = await getActiveSeason();
    if (!season) return NextResponse.json({ entries: [], seasonId: null });

    // 当日分だけ読む（等値2条件なので複合インデックス不要）。シーズン全件スキャンを避ける。
    const snap = await getDb()
      .collection("mahjongEntries")
      .where("seasonId", "==", season.seasonId)
      .where("eventDate", "==", eventDate)
      .get();

    const entries = snap.docs
      .map((d) => ({ ...(d.data() as MahjongEntry), entryId: d.id }))
      .sort((a, b) => (a.enteredAt ?? "").localeCompare(b.enteredAt ?? ""))
      // 一覧に現在状態（reserved/paid/cancelRequested/refunded/cancelRejected）を添える。
      // 「支払い済みで追加」しようとしている相手が今どの状態かを管理者に見せるため。
      .map((e) => ({ ...e, derivedStatus: deriveStatus(e) }));

    return NextResponse.json({ entries, seasonId: season.seasonId });
  } catch (error) {
    console.error("[admin/mahjong/entries] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

/**
 * POST /api/admin/mahjong/entries
 * 管理者が参加者を追加する。
 *
 * ■ なぜ「支払い済みで追加」が要るか
 *   支払い済みの人がミニアプリでキャンセルすると entry は cancelRequested / refunded になるが、
 *   Square 側で返金していなければ**入金は成立したまま**。この人を当日の卓に戻す手段が
 *   利用者側にも管理側にも無かった（受付締切後は再表明もできない）。
 *   同じ理由で「社員かどうかに関係なく、管理者が任意の利用者を支払い済みで足せる」ようにする。
 *
 * ■ 意図的にチェックしないもの（管理者の判断で押し切れるようにする）
 *   - 受付締切（entryClosedAt）… 締切後に来た支払い済みの人を足せないと運用が詰む。
 *     GM の卓振り分けプールは毎回 mahjongEntries から作り直すので、次の半荘から着席できる。
 *   - 定員8名・月1回制限 … 例外対応そのものなので弾かない（月ロックは今までどおり書く）。
 *
 * ⚠️ 入金の照合はしない（Square の注文が無い現金・振替も足せるようにするため）。
 *    誰が誰を支払い済みにしたかは監査ログ `entry.adminAdded` に必ず残す。
 *
 * body: { eventDate: string, lineUserId: string, markPaid?: boolean }
 *   markPaid=true（既定）… 参加費を受け取り済みとして扱う（GM の卓振り分け対象になる）。
 */
export async function POST(req: NextRequest) {
  const admin = await checkAdminAuth(req);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json().catch(() => null);
    const eventDate: unknown = body?.eventDate;
    const lineUserId: unknown = body?.lineUserId;
    // 既定は「支払い済みで追加」。明示的に false を渡したときだけ未払い（reserved）で足す。
    const markPaid = body?.markPaid !== false;
    if (typeof eventDate !== "string" || !DATE_RE.test(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }
    if (typeof lineUserId !== "string" || !lineUserId) {
      return NextResponse.json({ error: "lineUserId が不正です" }, { status: 400 });
    }

    const season = await getActiveSeason();
    if (!season) {
      return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });
    }
    // 参加者はアクティブシーズンにしか足せない（当日進行・卓振り分けがアクティブ基準のため）。
    // 管理画面は過去シーズンのページも開けるので、取り違えを 409 で弾く。
    if (typeof body?.seasonId === "string" && body.seasonId !== season.seasonId) {
      return NextResponse.json(
        { error: "開催中のシーズン以外には追加できません" },
        { status: 409 }
      );
    }

    const db = getDb();
    // 表示名・アイコンはサーバーが解決する（クライアント値を信用しない）。
    // LINE 連携済みの利用者は users doc を持つが、無い場合は authorizedUsers 側で補う。
    const [userDoc, authSnap] = await Promise.all([
      db.collection("users").doc(lineUserId).get(),
      db.collection("authorizedUsers").where("lineUserId", "==", lineUserId).limit(1).get(),
    ]);
    if (!userDoc.exists && authSnap.empty) {
      return NextResponse.json({ error: "ユーザーが存在しません" }, { status: 400 });
    }
    const u = userDoc.data() || {};
    const au = authSnap.docs[0]?.data() || {};
    const displayName = (u.displayName as string) || (au.displayName as string) || "ユーザー";

    // 利用者側と同じ決定的ID（形式がズレると同じ人のエントリーが二重にできる）。
    const entryId = buildMahjongEntryId(season.seasonId, eventDate, lineUserId);
    const ref = db.collection("mahjongEntries").doc(entryId);
    const existing = await ref.get();
    const prev = existing.exists ? (existing.data() as MahjongEntry) : null;
    const before = prev ? deriveStatus(prev) : null;

    const nowIso = new Date().toISOString();
    const entry: Partial<MahjongEntry> = {
      seasonId: season.seasonId,
      eventDate,
      lineUserId,
      displayName,
      pictureUrl: (u.pictureUrl as string) || "",
      // 再追加のときは最初の参加時刻を保つ（卓振り分けの FIFO 順が入れ替わらないように）。
      enteredAt: prev?.enteredAt || nowIso,
      status: markPaid ? "paid" : "reserved",
    };
    if (markPaid) {
      entry.paymentStatus = "paid";
      entry.paymentAmount = prev?.paymentAmount ?? MAHJONG_ENTRY_FEE;
      entry.paidAt = prev?.paidAt || nowIso;
    }

    // 月ロックは管理者追加でも今までどおり書く（書かないとその月が無制限のまま残る）。
    const lockRef = db
      .collection("mahjongMonthlyLocks")
      .doc(`${season.seasonId}_${lineUserId}_${eventDate.slice(0, 7)}`);

    const batch = db.batch();
    batch.set(ref, entry, { merge: true });
    batch.set(lockRef, {
      seasonId: season.seasonId,
      lineUserId,
      ym: eventDate.slice(0, 7),
      eventDate,
      updatedAt: nowIso,
    });
    await batch.commit();

    await writeAuditLog({
      eventType: "entry.adminAdded",
      gameCategory: "mahjong",
      actor: `admin:${admin}`,
      target: { date: eventDate, entryId, lineUserId },
      beforeStatus: before,
      afterStatus: markPaid ? "paid" : "reserved",
      meta: { markPaid, displayName },
    });

    return NextResponse.json(
      { entry: { ...entry, entryId }, previousStatus: before },
      { status: 201 }
    );
  } catch (error) {
    console.error("[admin/mahjong/entries] POST error:", error);
    return NextResponse.json({ error: "追加に失敗しました" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/mahjong/entries?eventDate=YYYY-MM-DD&lineUserId=xxx
 * 管理者が参加者を取り消す
 */
export async function DELETE(req: NextRequest) {
  const admin = await checkAdminAuth(req);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const eventDate = req.nextUrl.searchParams.get("eventDate");
    const lineUserId = req.nextUrl.searchParams.get("lineUserId");
    if (!eventDate || !DATE_RE.test(eventDate) || !lineUserId) {
      return NextResponse.json({ error: "パラメータが不正です" }, { status: 400 });
    }
    const season = await getActiveSeason();
    if (!season) return NextResponse.json({ success: true });

    const db = getDb();
    const entryId = buildMahjongEntryId(season.seasonId, eventDate, lineUserId);
    const ref = db.collection("mahjongEntries").doc(entryId);
    const snap = await ref.get();
    const before = snap.exists ? deriveStatus(snap.data() as MahjongEntry) : null;
    await ref.delete();

    await writeAuditLog({
      eventType: "entry.adminRemoved",
      gameCategory: "mahjong",
      actor: `admin:${admin}`,
      target: { date: eventDate, entryId, lineUserId },
      beforeStatus: before,
      afterStatus: null,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/mahjong/entries] DELETE error:", error);
    return NextResponse.json({ error: "取消に失敗しました" }, { status: 500 });
  }
}
