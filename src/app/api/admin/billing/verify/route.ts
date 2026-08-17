import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { GAME_PAYMENT_CONFIG } from "@/lib/gameEntryPayment";
import { getFacilitySquareCredentials } from "@/lib/facilitySecrets";
import { fetchSquareOrderPayment } from "@/lib/square";
import { isBillingSource, summarizeSquarePayment } from "@/lib/billing";
import type { ScoreboardGameId } from "@/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/billing/verify  Body: { source, refId }
 * 請求1件を Square に問い合わせて、実際の決済（金額・状態・返金額・レシートURL）を返す。
 *
 * ■ なぜ要るか
 *   Square 管理画面の検索窓は注文ID(orderId)で引けない（orderId は API 用の識別子）。
 *   一覧から Square 側へ辿るには、注文ID → 決済ID → レシートURL の解決が要る。
 *
 * ■ ⚠️ これは**読み取り専用の照合**。支払い状態（paymentStatus / status）は絶対に書き換えない。
 *   「未払いを支払い済みにする」のは `gameEntryPayment.markGameEntryPaid`、
 *   「返金済みにする」のは予約の refund ルート。入口を混ぜないこと。
 *   ここが保存するのは参照情報（決済ID・レシートURL・照合時刻）だけ。
 */

interface Body {
  source?: unknown;
  refId?: unknown;
}

/** 種目/予約ごとの参照先。 */
function resolveTarget(source: string, refId: string) {
  if (source === "reservation") {
    return { collection: "reservations", purpose: "reservation" as const, game: null };
  }
  const game = source as ScoreboardGameId;
  return { collection: GAME_PAYMENT_CONFIG[game].entries, purpose: game, game };
}

export async function POST(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body: Body = await req.json().catch(() => ({}));
    const source = body.source;
    const refId = body.refId;
    if (!isBillingSource(source)) {
      return NextResponse.json({ error: "source が不正です" }, { status: 400 });
    }
    if (typeof refId !== "string" || !/^[A-Za-z0-9_-]+$/.test(refId)) {
      return NextResponse.json({ error: "refId が不正です" }, { status: 400 });
    }

    const target = resolveTarget(source, refId);
    const ref = getDb().collection(target.collection).doc(refId);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "対象が見つかりません" }, { status: 404 });

    const d = snap.data() as {
      facilityId?: string;
      paymentTransactionId?: string;
      paymentAmount?: number;
    };
    const orderId = d.paymentTransactionId;
    if (!orderId) {
      return NextResponse.json(
        { error: "Square の注文IDがありません（決済リンクが未発行＝Square に記録がありません）" },
        { status: 409 },
      );
    }

    const expectedAmount =
      d.paymentAmount ?? (target.game ? GAME_PAYMENT_CONFIG[target.game].fee : 0);

    // 施設ごとの Square 設定があれば優先（無ければ環境変数の SQUARE_* にフォールバック）。
    const credentials =
      source === "reservation" && d.facilityId
        ? (await getFacilitySquareCredentials(d.facilityId)) ?? undefined
        : undefined;

    let result;
    try {
      const { paymentId, payment } = await fetchSquareOrderPayment({
        orderId,
        purpose: target.purpose,
        credentials,
      });
      result = summarizeSquarePayment(paymentId, payment, expectedAmount);
    } catch (e) {
      return NextResponse.json(
        { error: `Square から取得できませんでした: ${e instanceof Error ? e.message : String(e)}` },
        { status: 502 },
      );
    }

    // 参照情報だけ保存する（次回から照合なしで開ける）。支払い状態には触れない。
    await ref.update({
      squarePaymentId: result.paymentId,
      squareReceiptUrl: result.receiptUrl ?? null,
      squareVerifiedAt: new Date().toISOString(),
    });

    return NextResponse.json({ orderId, expectedAmount, payment: result });
  } catch (error) {
    console.error("[admin/billing/verify] POST error:", error);
    return NextResponse.json({ error: "照合に失敗しました" }, { status: 500 });
  }
}
