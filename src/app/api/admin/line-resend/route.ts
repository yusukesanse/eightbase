import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getDb } from "@/lib/firebaseAdmin";
import { notifyContentPublishedOnce, sanitizeAudience } from "@/lib/line";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/line-resend
 * body: { type: "news" | "event"; id: string }
 *
 * 公開通知の**手動再送**。配信に失敗した（＝`lineNotifyResult.ok === false`）doc を救済する唯一の経路。
 *
 * なぜ必要か:
 *   `notifyContentPublishedOnce` は二重送信を防ぐため、配信が失敗しても「通知済み」の主張
 *   （`lineNotifiedAt`）を維持する。配信上限の超過は**1通も届いていないのに**失敗するので、
 *   そのままだとプランを増枠しても二度と送られない。管理者が明示的に押したときだけ
 *   `force` で主張を上書きして送り直せるようにする。
 *
 * 自動では再送しない（意図せず全員へ二重配信すると通数も信用も失う）。
 */

const TYPES = {
  news: { collection: "news", contentType: "news" as const, fallbackTitle: "新しいニュース" },
  event: { collection: "events", contentType: "event" as const, fallbackTitle: "新しいイベント" },
};

export async function POST(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const type = String(body.type ?? "") as keyof typeof TYPES;
    const id = typeof body.id === "string" ? body.id.trim() : "";

    const spec = TYPES[type];
    if (!spec) {
      return NextResponse.json({ error: "type は news / event のいずれかです" }, { status: 400 });
    }
    if (!id) {
      return NextResponse.json({ error: "id は必須です" }, { status: 400 });
    }

    const db = getDb();
    const snap = await db.collection(spec.collection).doc(id).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "対象が見つかりません" }, { status: 404 });
    }
    const data = snap.data() ?? {};

    // 未公開のものを再送しない（公開前に通知が飛ぶ事故を防ぐ）。
    if (data.published !== true) {
      return NextResponse.json({ error: "公開中のものだけ再送できます" }, { status: 400 });
    }

    const audience = sanitizeAudience(data.lineBroadcastAudience, spec.contentType);
    if (audience.length === 0) {
      return NextResponse.json({ error: "配信先が設定されていません" }, { status: 400 });
    }

    const title = (data.title as string) || spec.fallbackTitle;
    const result = await notifyContentPublishedOnce(
      db,
      spec.collection,
      id,
      spec.contentType,
      title,
      true, // 管理者が明示的に押している以上、lineNotify の既定値では止めない
      audience,
      { force: true },
    );

    if (!result.sent) {
      return NextResponse.json(
        { error: result.error ?? "再送に失敗しました", reason: result.reason },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true, recipientCount: result.recipientCount });
  } catch (error) {
    console.error("[admin/line-resend] POST error:", error);
    return NextResponse.json({ error: "再送に失敗しました" }, { status: 500 });
  }
}
