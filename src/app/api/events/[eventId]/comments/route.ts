import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireMember, requireMemberProfileComplete } from "@/lib/auth";
import { validateCommentBody, isTooSoon, type EventComment } from "@/lib/eventComments";

export const dynamic = "force-dynamic";

/**
 * GET /api/events/[eventId]/comments — コメント一覧（会員のみ・古い順）。
 * ゲストは requireMember で除外（イベント自体が会員専用）。
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const userId = await requireMember(req);
  if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const { eventId } = await params;
  try {
    const db = getDb();
    const snap = await db.collection("events").doc(eventId).collection("comments").get();
    const comments = snap.docs
      .map((d) => ({ commentId: d.id, ...(d.data() as Omit<EventComment, "commentId">) }))
      .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))
      .map((c) => ({
        commentId: c.commentId,
        authorId: c.authorId,
        authorName: c.authorName,
        authorPictureUrl: c.authorPictureUrl ?? "",
        body: c.body,
        createdAt: c.createdAt,
        isMine: c.authorId === userId,
      }));
    return NextResponse.json({ comments, currentUserId: userId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[events/comments] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

/**
 * POST /api/events/[eventId]/comments — コメント投稿（会員かつプロフィール完了）。
 * Body: { body }。空文字/空白のみ/文字数上限をサーバー検証。連投は COOLDOWN で拒否。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const userId = await requireMemberProfileComplete(req);
  if (!userId) {
    return NextResponse.json(
      { error: "PROFILE_REQUIRED", message: "コメントの投稿にはプロフィール登録が必要です。" },
      { status: 401 }
    );
  }

  const { eventId } = await params;
  const body = await req.json().catch(() => null);
  const check = validateCommentBody(body?.body);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  try {
    const db = getDb();
    const eventRef = db.collection("events").doc(eventId);
    const eventDoc = await eventRef.get();
    if (!eventDoc.exists) return NextResponse.json({ error: "イベントが見つかりません" }, { status: 404 });

    // 連投対策: 同一ユーザーの同イベント直近投稿から COOLDOWN 未満なら拒否（等値クエリのみ＝索引不要）。
    const mineSnap = await eventRef.collection("comments").where("authorId", "==", userId).get();
    const lastCreatedAt = mineSnap.docs
      .map((d) => (d.data().createdAt as string) ?? "")
      .sort()
      .pop() ?? null;
    if (isTooSoon(lastCreatedAt, Date.now())) {
      return NextResponse.json(
        { error: "TOO_SOON", message: "少し時間をおいてから投稿してください。" },
        { status: 429 }
      );
    }

    // 表示名/アバターは投稿時点のスナップショット（掲示板と同方針・一覧で users join に依存しない）。
    const userDoc = await db.collection("users").doc(userId).get();
    const u = userDoc.data() || {};
    const nowIso = new Date().toISOString();
    const commentRef = eventRef.collection("comments").doc();
    const comment: Omit<EventComment, "commentId"> = {
      eventId,
      authorId: userId,
      authorName: u.displayName || "ユーザー",
      authorPictureUrl: u.pictureUrl || "",
      body: check.value,
      createdAt: nowIso,
    };
    await commentRef.set(comment);

    return NextResponse.json({ comment: { commentId: commentRef.id, ...comment, isMine: true } }, { status: 201 });
  } catch (error) {
    console.error("[events/comments] POST error:", error);
    return NextResponse.json({ error: "投稿に失敗しました" }, { status: 500 });
  }
}
