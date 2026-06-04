import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { getSessionUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/games/[gameId]/join
 * ゲームに参加申込
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  try {
    const userId = await getSessionUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const { gameId } = await params;
    const db = getDb();

    // ゲーム存在＋公開チェック
    const gameRef = db.collection("games").doc(gameId);
    const gameDoc = await gameRef.get();
    if (!gameDoc.exists || !gameDoc.data()?.published) {
      return NextResponse.json({ error: "ゲームが見つかりません" }, { status: 404 });
    }

    const game = gameDoc.data()!;

    // ステータスチェック
    if (game.status !== "upcoming") {
      return NextResponse.json({ error: "このゲームは現在募集していません" }, { status: 400 });
    }

    // 締切チェック
    if (new Date(game.deadline) < new Date()) {
      return NextResponse.json({ error: "申込締切を過ぎています" }, { status: 400 });
    }

    // 定員チェック
    const currentCount = game.participantCount ?? 0;
    if (currentCount >= game.maxParticipants) {
      return NextResponse.json({ error: "定員に達しています" }, { status: 400 });
    }

    // 重複チェック
    const partRef = gameRef.collection("participants").doc(userId);
    const partDoc = await partRef.get();
    if (partDoc.exists) {
      return NextResponse.json({ error: "既に参加申込済みです" }, { status: 409 });
    }

    // ユーザー情報取得
    const userDoc = await db.collection("users").doc(userId).get();
    const userData = userDoc.data() || {};

    // 参加登録
    await partRef.set({
      lineUserId: userId,
      displayName: userData.displayName || "ユーザー",
      pictureUrl: userData.pictureUrl || "",
      joinedAt: new Date().toISOString(),
    });

    // 参加者数を更新
    await gameRef.update({
      participantCount: currentCount + 1,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[games/join] POST error:", error);
    return NextResponse.json({ error: "参加に失敗しました" }, { status: 500 });
  }
}

/**
 * DELETE /api/games/[gameId]/join
 * ゲーム参加取消
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  try {
    const userId = await getSessionUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const { gameId } = await params;
    const db = getDb();

    const gameRef = db.collection("games").doc(gameId);
    const gameDoc = await gameRef.get();
    if (!gameDoc.exists) {
      return NextResponse.json({ error: "ゲームが見つかりません" }, { status: 404 });
    }

    const game = gameDoc.data()!;

    // 締切前のみキャンセル可能
    if (new Date(game.deadline) < new Date()) {
      return NextResponse.json({ error: "申込締切を過ぎているためキャンセルできません" }, { status: 400 });
    }

    const partRef = gameRef.collection("participants").doc(userId);
    const partDoc = await partRef.get();
    if (!partDoc.exists) {
      return NextResponse.json({ error: "参加していません" }, { status: 404 });
    }

    await partRef.delete();

    const currentCount = game.participantCount ?? 0;
    await gameRef.update({
      participantCount: Math.max(0, currentCount - 1),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[games/join] DELETE error:", error);
    return NextResponse.json({ error: "キャンセルに失敗しました" }, { status: 500 });
  }
}
