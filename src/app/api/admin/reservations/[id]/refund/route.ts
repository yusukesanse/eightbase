import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getFacilitySquareCredentials } from "@/lib/facilitySecrets";
import { getSquarePayment } from "@/lib/square";
import { evaluateSquareRefund } from "@/lib/billing";
import { writeReservationAudit } from "@/lib/reservationAudit";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/reservations/[id]/refund
 * 入金済のまま取消された予約を「返金済」として記録する（請求管理から呼ぶ）。
 *
 * ■ 位置づけ
 *   Square の返金操作そのものはアプリからは行わない（Square 管理画面で手動返金する）。
 *   ゲーム参加費の返金（`/api/admin/{game}/refund`）と同じ「実返金は手動・アプリは記録」方式に
 *   そろえてある。**ここに実返金を足すなら4種目側と一緒に設計すること**（片側だけ増やさない）。
 *
 * ■ 安全策
 *   - 対象は「決済額あり × paymentStatus=completed × status=cancelled」だけ。
 *     利用中の予約を返金済にはできない（先にキャンセルする）。
 *   - **Square に返金があるかを照合する**。見つからなければ 409 で止め、
 *     それでも記録する場合だけ `force: true` を要求する（現金返金・別アカウント返金の逃げ道）。
 *     照合できたかどうかは `refundVerified` として予約に残す（後から見分けられるように）。
 */

interface Body {
  force?: boolean;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await checkAdminAuth(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
    return NextResponse.json({ error: "id が不正です" }, { status: 400 });
  }

  try {
    const body: Body = await req.json().catch(() => ({}));
    const force = body.force === true;

    const db = getDb();
    const ref = db.collection("reservations").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "予約が見つかりません" }, { status: 404 });

    const r = snap.data() as {
      facilityId?: string;
      paymentAmount?: number;
      paymentStatus?: string;
      paymentId?: string;
      squarePaymentId?: string;
      status?: string;
    };
    // 決済時に書かれた paymentId が正。旧データは請求管理の「照合」が squarePaymentId に入れる。
    // 片方しか見ないと、照合済みでも Square 返金を確認できず force 記録に落ちてしまう。
    const paymentId = r.paymentId ?? r.squarePaymentId;

    const amount = r.paymentAmount ?? 0;
    if (amount <= 0) {
      return NextResponse.json({ error: "決済額のない予約です（返金対象ではありません）" }, { status: 409 });
    }
    if (r.paymentStatus === "refunded") {
      return NextResponse.json({ success: true, alreadyRefunded: true });
    }
    if (r.paymentStatus !== "completed") {
      return NextResponse.json(
        { error: `入金が確認できていない予約です（現在: ${r.paymentStatus ?? "未入金"}）` },
        { status: 409 },
      );
    }
    if (r.status !== "cancelled") {
      return NextResponse.json(
        { error: "取消されていない予約は返金済にできません。先に予約をキャンセルしてください。" },
        { status: 409 },
      );
    }

    // ── Square 照合（施設ごとの認証情報があればそれを使う） ──
    let verified = false;
    let refundedAmount = 0;
    let checkError: string | null = null;
    if (paymentId) {
      try {
        const credentials = r.facilityId
          ? (await getFacilitySquareCredentials(r.facilityId)) ?? undefined
          : undefined;
        const payment = await getSquarePayment(paymentId, "reservation", credentials);
        const check = evaluateSquareRefund(payment, amount);
        verified = check.state !== "none";
        refundedAmount = check.refundedAmount;
      } catch (e) {
        checkError = e instanceof Error ? e.message : "Square に問い合わせできませんでした";
      }
    } else {
      checkError = "決済IDが記録されていません";
    }

    if (!verified && !force) {
      return NextResponse.json(
        {
          error:
            "Square で返金を確認できませんでした。" +
            (checkError ? `（${checkError}）` : "") +
            " 先に Square 管理画面で返金してください。現金対応など別手段で返金済みの場合のみ、確認のうえ記録できます。",
          code: "REFUND_NOT_FOUND",
        },
        { status: 409 },
      );
    }

    const nowIso = new Date().toISOString();
    await ref.update({
      paymentStatus: "refunded",
      refundProcessedAt: nowIso,
      refundProcessedBy: admin,
      // Square で返金を確認できたか。false は「管理者の申告のみ」＝後から追跡できるようにする。
      refundVerified: verified,
      refundedAmount: verified ? refundedAmount : null,
      updatedAt: nowIso,
    });

    await writeReservationAudit({
      eventType: "payment.refunded",
      reservationId: id,
      facilityId: r.facilityId,
      actor: admin,
      reason: verified
        ? `Square照合OK（返金額 ${refundedAmount}円）`
        : `Square未照合のまま記録${checkError ? `（${checkError}）` : ""}`,
    });

    return NextResponse.json({ success: true, verified, refundedAmount });
  } catch (error) {
    console.error("[admin/reservations/refund] POST error:", error);
    return NextResponse.json({ error: "返金の記録に失敗しました" }, { status: 500 });
  }
}
