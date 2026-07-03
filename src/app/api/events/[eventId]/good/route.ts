import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireMember } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/events/[eventId]/good
 * イベントへのグッド（1ユーザー1回、トランザクションで整合）
 *
 * Body: { action: "add" | "remove" }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const userId = await requireMember(req);
  if (!userId) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { eventId } = await params;

  let action: string;
  try {
    const body = await req.json();
    action = body.action;
  } catch {
    return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
  }

  if (action !== "add" && action !== "remove") {
    return NextResponse.json({ error: "action は 'add' または 'remove' を指定してください" }, { status: 400 });
  }

  const db = getDb();
  const eventRef = db.collection("events").doc(eventId);
  const goodRef = eventRef.collection("goods").doc(userId);

  const result = await db.runTransaction(async (tx) => {
    const eventDoc = await tx.get(eventRef);
    if (!eventDoc.exists) {
      return { error: "イベントが見つかりません", status: 404 };
    }

    const goodDoc = await tx.get(goodRef);
    const currentCount = eventDoc.data()?.goodCount ?? 0;

    if (action === "add") {
      if (goodDoc.exists) {
        return { goodCount: currentCount }; // 既にgood済み、カウント変更なし
      }
      tx.set(goodRef, { userId, createdAt: new Date().toISOString() });
      tx.update(eventRef, { goodCount: currentCount + 1 });
      return { goodCount: currentCount + 1 };
    } else {
      if (!goodDoc.exists) {
        return { goodCount: currentCount }; // good していない
      }
      tx.delete(goodRef);
      tx.update(eventRef, { goodCount: Math.max(0, currentCount - 1) });
      return { goodCount: Math.max(0, currentCount - 1) };
    }
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status || 500 });
  }

  return NextResponse.json({ eventId, goodCount: result.goodCount });
}
