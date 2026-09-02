import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getActiveSeason } from "@/lib/mahjong";
import { buildMahjongEntryId } from "@/lib/mahjongEntryValidation";
import { deriveStatus } from "@/lib/mahjongEntryStatus";
import { writeAuditLog } from "@/lib/auditLog";
import { addGameEntryByAdmin } from "@/lib/adminGameEntry";
import type { MahjongEntry } from "@/types";

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

    const result = await addGameEntryByAdmin({
      game: "mahjong",
      seasonId: typeof body?.seasonId === "string" ? body.seasonId : undefined,
      eventDate,
      lineUserId,
      markPaid,
      admin,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(
      { entry: result.entry, previousStatus: result.previousStatus },
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
