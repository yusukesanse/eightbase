import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUserWithRole } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { canCancelMahjong, MAHJONG_CANCEL_POLICY } from "@/lib/date";
import { canTransition, deriveStatus } from "@/lib/dartsEntryStatus";
import { writeAuditLog } from "@/lib/auditLog";
import { isValidDartsDate, buildDartsEntryId } from "@/lib/dartsEntryValidation";
import type { DartsEntry } from "@/types/darts";
import dayjs from "dayjs";

export const dynamic = "force-dynamic";

/**
 * POST /api/darts/entries/cancel-payment  Body: { eventDate }
 * 支払い済み参加費のキャンセル依頼。**自動返金はしない**。エントリーを cancelRequested にし、
 * 管理者へ手動返金（Square webアプリ）通知を飛ばす。キャンセル期限は開催日の7日前まで（麻雀と共通）。
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireGameUserWithRole(req);
    if (!auth) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    const userId = auth.lineUserId;

    const body = await req.json().catch(() => null);
    const eventDate: unknown = body?.eventDate;
    if (!isValidDartsDate(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }

    const season = await getActiveSeason("darts");
    if (!season) {
      return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });
    }

    const db = getDb();
    const entryId = buildDartsEntryId(season.seasonId, eventDate, userId);
    const entryRef = db.collection("dartsEntries").doc(entryId);
    const snap = await entryRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "参加表明が見つかりません" }, { status: 404 });
    }
    const entry = { ...(snap.data() as DartsEntry), entryId };
    if (entry.lineUserId !== userId) {
      return NextResponse.json(
        { error: "NOT_OWNER", message: "対象の参加表明が見つかりません。" },
        { status: 400 }
      );
    }
    // 冪等: 既にキャンセル依頼済みなら成功で返す（二重通知しない）。
    if (deriveStatus(entry) === "cancelRequested") {
      return NextResponse.json({ success: true, already: true });
    }
    if (entry.paymentStatus !== "paid") {
      return NextResponse.json(
        { error: "NOT_PAID", message: "お支払い済みの参加費のみキャンセルできます。" },
        { status: 400 }
      );
    }
    if (!canCancelMahjong(eventDate)) {
      return NextResponse.json({ error: "DEADLINE_PASSED", message: MAHJONG_CANCEL_POLICY }, { status: 409 });
    }
    const from = deriveStatus(entry);
    if (!canTransition(from, "cancelRequested")) {
      return NextResponse.json(
        { error: "INVALID_TRANSITION", message: "現在の状態ではキャンセルできません。" },
        { status: 409 }
      );
    }

    const nowIso = dayjs().toISOString();
    // entry 遷移と管理者通知（永続doc）を1トランザクションで原子化する（通知の取りこぼしを防ぐ）。
    let didTransition = false;
    try {
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(entryRef);
        if (!fresh.exists) throw new Error("NOT_FOUND");
        const cur = fresh.data() as DartsEntry;
        const st = deriveStatus(cur);
        if (st === "cancelRequested") return; // 併走で先に依頼済み＝冪等
        if (cur.paymentStatus !== "paid" || st !== "paid") throw new Error("NOT_PAID");
        tx.update(entryRef, {
          status: "cancelRequested",
          paymentStatus: "cancelRequested",
          cancelRequestedAt: nowIso,
          updatedAt: nowIso,
        });
        tx.create(db.collection("adminNotifications").doc(), {
          type: "darts_refund",
          message: `参加費のキャンセル依頼がありました。Squareで返金対応をお願いします（${entry.displayName} / エントリー ${entryId} / 注文 ${entry.paymentTransactionId ?? "-"}）。`,
          data: { entryId, orderId: entry.paymentTransactionId ?? null, lineUserId: userId, eventDate },
          read: false,
          createdAt: nowIso,
        });
        didTransition = true;
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      if (m === "NOT_FOUND") return NextResponse.json({ error: "NOT_FOUND", message: "参加表明が見つかりません" }, { status: 404 });
      if (m === "NOT_PAID") return NextResponse.json({ error: "NOT_PAID", message: "お支払い済みの参加費のみキャンセルできます。" }, { status: 400 });
      throw e;
    }

    if (didTransition) {
      // 監査ログは best-effort（失敗しても返金対象データ＝entry の cancelRequested は残る）。
      // ここで throw させると tx 成功後に 500 を返してしまうため、必ず個別に握り潰す。
      try {
        await writeAuditLog({
          eventType: "payment.cancelRequested",
          gameCategory: "darts",
          actor: userId,
          target: { entryId, date: eventDate },
          beforeStatus: from,
          afterStatus: "cancelRequested",
        });
      } catch (e) {
        console.error("[darts/entries/cancel-payment] audit log failed (best-effort):", e);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[darts/entries/cancel-payment] POST error:", message, err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "キャンセル処理中にエラーが発生しました" },
      { status: 500 }
    );
  }
}
