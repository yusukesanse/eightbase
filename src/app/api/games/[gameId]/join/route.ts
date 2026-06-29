import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/games/[gameId]/join
 * ゲームに参加申込（トランザクションで定員管理）
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  try {
    const userId = await requireGameUser(req);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const { gameId } = await params;
    const db = getDb();
    const gameRef = db.collection("games").doc(gameId);
    const partRef = gameRef.collection("participants").doc(userId);

    const result = await db.runTransaction(async (tx) => {
      const gameDoc = await tx.get(gameRef);
      if (!gameDoc.exists || !gameDoc.data()?.published) {
        return { error: "ゲームが見つかりません", status: 404 };
      }

      const game = gameDoc.data()!;

      if (game.status !== "upcoming") {
        return { error: "このゲームは現在募集していません", status: 400 };
      }
      if (new Date(game.deadline) < new Date()) {
        return { error: "申込締切を過ぎています", status: 400 };
      }

      const currentCount = game.participantCount ?? 0;
      if (currentCount >= game.maxParticipants) {
        return { error: "定員に達しています", status: 400 };
      }

      const partDoc = await tx.get(partRef);
      if (partDoc.exists) {
        return { error: "既に参加申込済みです", status: 409 };
      }

      // ユーザー情報取得（transaction外で読んでも問題ない補助データ）
      const userDoc = await db.collection("users").doc(userId).get();
      const userData = userDoc.data() || {};

      tx.set(partRef, {
        lineUserId: userId,
        displayName: userData.displayName || "ユーザー",
        pictureUrl: userData.pictureUrl || "",
        joinedAt: new Date().toISOString(),
      });

      tx.update(gameRef, { participantCount: currentCount + 1 });

      return { success: true };
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status || 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[games/join] POST error:", error);
    return NextResponse.json({ error: "参加に失敗しました" }, { status: 500 });
  }
}

/**
 * DELETE /api/games/[gameId]/join
 * ゲーム参加取消（トランザクションでカウント整合）
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  try {
    const userId = await requireGameUser(req);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const { gameId } = await params;
    const db = getDb();
    const gameRef = db.collection("games").doc(gameId);
    const partRef = gameRef.collection("participants").doc(userId);

    const result = await db.runTransaction(async (tx) => {
      const gameDoc = await tx.get(gameRef);
      if (!gameDoc.exists) {
        return { error: "ゲームが見つかりません", status: 404 };
      }

      const game = gameDoc.data()!;
      if (new Date(game.deadline) < new Date()) {
        return { error: "申込締切を過ぎているためキャンセルできません", status: 400 };
      }

      const partDoc = await tx.get(partRef);
      if (!partDoc.exists) {
        return { error: "参加していません", status: 404 };
      }

      tx.delete(partRef);
      tx.update(gameRef, { participantCount: Math.max(0, (game.participantCount ?? 0) - 1) });

      return { success: true };
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status || 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[games/join] DELETE error:", error);
    return NextResponse.json({ error: "キャンセルに失敗しました" }, { status: 500 });
  }
}
