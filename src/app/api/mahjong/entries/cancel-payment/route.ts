import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUserWithRole } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { notifyAdmin } from "@/lib/adminNotify";
import { canCancelMahjong, MAHJONG_CANCEL_DEADLINE_DAYS } from "@/lib/date";
import type { MahjongEntry } from "@/types";
import dayjs from "dayjs";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /api/mahjong/entries/cancel-payment  Body: { eventDate }
 * 支払い済み参加費のキャンセル依頼。**自動返金はしない**。
 * エントリーを cancelRequested にし、管理者へ手動返金（Square webアプリ）通知を飛ばす。
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireGameUserWithRole(req);
    if (!auth) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }
    const userId = auth.lineUserId;

    const body = await req.json().catch(() => null);
    const eventDate: unknown = body?.eventDate;
    if (typeof eventDate !== "string" || !DATE_RE.test(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }

    const season = await getActiveSeason();
    if (!season) {
      return NextResponse.json(
        { error: "アクティブなシーズンがありません" },
        { status: 400 }
      );
    }

    const db = getDb();
    const entryId = `${season.seasonId}_${eventDate}_${userId}`;
    const entryRef = db.collection("mahjongEntries").doc(entryId);
    const snap = await entryRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "参加表明が見つかりません" }, { status: 404 });
    }
    const entry = { ...(snap.data() as MahjongEntry), entryId };
    if (entry.lineUserId !== userId) {
      return NextResponse.json(
        { error: "NOT_OWNER", message: "対象の参加表明が見つかりません。" },
        { status: 400 }
      );
    }
    if (entry.paymentStatus !== "paid") {
      return NextResponse.json(
        { error: "NOT_PAID", message: "お支払い済みの参加費のみキャンセルできます。" },
        { status: 400 }
      );
    }
    // キャンセル期限: 開催日の7日前まで。6日前以降は100%返金不可。
    if (!canCancelMahjong(eventDate)) {
      return NextResponse.json(
        { error: "DEADLINE_PASSED", message: `キャンセルは開催日の${MAHJONG_CANCEL_DEADLINE_DAYS}日前までです（6日前以降は返金できません）。` },
        { status: 409 }
      );
    }

    const nowIso = dayjs().toISOString();
    await entryRef.set(
      { paymentStatus: "cancelRequested", cancelRequestedAt: nowIso, updatedAt: nowIso },
      { merge: true }
    );

    await notifyAdmin(
      "mahjong_refund",
      `参加費のキャンセル依頼がありました。Squareで返金対応をお願いします（${entry.displayName} / エントリー ${entryId} / 注文 ${entry.paymentTransactionId ?? "-"}）。`,
      {
        entryId,
        orderId: entry.paymentTransactionId ?? null,
        lineUserId: userId,
        eventDate,
      }
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mahjong/entries/cancel-payment] POST error:", message, err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "キャンセル処理中にエラーが発生しました" },
      { status: 500 }
    );
  }
}
