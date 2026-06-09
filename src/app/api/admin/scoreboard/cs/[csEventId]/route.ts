import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import type { CsCandidate, ScoreboardGameId } from "@/types";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ csEventId: string }> };

/**
 * GET /api/admin/scoreboard/cs/[csEventId]
 * CSイベント詳細
 */
export async function GET(req: NextRequest, { params }: RouteCtx) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { csEventId } = await params;
    const db = getDb();
    const doc = await db.collection("cs_events").doc(csEventId).get();
    if (!doc.exists) {
      return NextResponse.json({ error: "CSイベントが見つかりません" }, { status: 404 });
    }

    return NextResponse.json({ csEventId: doc.id, ...doc.data() });
  } catch (error) {
    console.error("[admin/scoreboard/cs/[id]] GET error:", error);
    return NextResponse.json({ error: "CSイベント取得に失敗しました" }, { status: 500 });
  }
}

/**
 * PUT /api/admin/scoreboard/cs/[csEventId]
 * CSイベント更新 / 候補者ステータス変更 / LINE通知送信
 *
 * Body variants:
 *   1. { action: "update", title, description, startAt, endAt, location, status }
 *   2. { action: "decline", lineUserId, gameCategory } — 辞退 + 自動繰り上げ
 *   3. { action: "notify" } — CS候補者へLINE通知送信
 */
export async function PUT(req: NextRequest, { params }: RouteCtx) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { csEventId } = await params;
    const db = getDb();
    const csRef = db.collection("cs_events").doc(csEventId);
    const csDoc = await csRef.get();

    if (!csDoc.exists) {
      return NextResponse.json({ error: "CSイベントが見つかりません" }, { status: 404 });
    }

    const body = await req.json();
    const action = body.action || "update";
    const csData = csDoc.data()!;
    const now = new Date().toISOString();

    /* ─── action: update ─── */
    if (action === "update") {
      const allowed = ["title", "description", "startAt", "endAt", "location", "status", "published"];
      const update: Record<string, unknown> = { updatedAt: now };
      for (const key of allowed) {
        if (body[key] !== undefined) update[key] = body[key];
      }
      await csRef.update(update);
      return NextResponse.json({ success: true });
    }

    /* ─── action: decline ─── */
    if (action === "decline") {
      const { lineUserId, gameCategory } = body as {
        lineUserId: string;
        gameCategory: ScoreboardGameId;
      };

      if (!lineUserId || !gameCategory) {
        return NextResponse.json({ error: "lineUserId, gameCategory は必須です" }, { status: 400 });
      }

      const candidates: CsCandidate[] = csData.candidates || [];

      // 辞退対象を特定
      const targetIdx = candidates.findIndex(
        (c) => c.lineUserId === lineUserId && c.gameCategory === gameCategory && c.status === "active"
      );
      if (targetIdx === -1) {
        return NextResponse.json({ error: "該当するアクティブ候補者が見つかりません" }, { status: 404 });
      }

      candidates[targetIdx].status = "declined";
      const declinedRank = candidates[targetIdx].annualRank;
      const seasonId = csData.seasonId as string;

      // 繰り上げ: 同じ種目で次のランクのユーザーを取得
      const nextCandidate = await findNextCandidate(
        db,
        seasonId,
        gameCategory,
        candidates,
        declinedRank
      );

      if (nextCandidate) {
        candidates.push(nextCandidate);
      }

      await csRef.update({ candidates, updatedAt: now });

      return NextResponse.json({
        success: true,
        declined: lineUserId,
        promoted: nextCandidate?.lineUserId ?? null,
        candidates,
      });
    }

    /* ─── action: notify ─── */
    if (action === "notify") {
      const candidates: CsCandidate[] = csData.candidates || [];
      const activeUserIds = candidates
        .filter((c) => c.status === "active" || c.status === "promoted")
        .map((c) => c.lineUserId);

      const uniqueIds = Array.from(new Set(activeUserIds));

      if (uniqueIds.length === 0) {
        return NextResponse.json({ error: "通知対象の候補者がいません" }, { status: 400 });
      }

      // LINE通知送信
      const { sendCsNotification } = await import("@/lib/line");
      await sendCsNotification(uniqueIds, {
        title: csData.title as string,
        startAt: csData.startAt as string,
        location: csData.location as string,
      });

      await csRef.update({ notifiedCandidates: true, updatedAt: now });

      return NextResponse.json({ success: true, notifiedCount: uniqueIds.length });
    }

    return NextResponse.json({ error: "不明なアクションです" }, { status: 400 });
  } catch (error) {
    console.error("[admin/scoreboard/cs/[id]] PUT error:", error);
    return NextResponse.json({ error: "CS更新に失敗しました" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/scoreboard/cs/[csEventId]
 */
export async function DELETE(req: NextRequest, { params }: RouteCtx) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { csEventId } = await params;
    const db = getDb();
    const csRef = db.collection("cs_events").doc(csEventId);
    const doc = await csRef.get();
    if (!doc.exists) {
      return NextResponse.json({ error: "CSイベントが見つかりません" }, { status: 404 });
    }

    await csRef.delete();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/scoreboard/cs/[id]] DELETE error:", error);
    return NextResponse.json({ error: "CS削除に失敗しました" }, { status: 500 });
  }
}

/* ───────── ヘルパー: 繰り上げ候補者を検索 ───────── */

async function findNextCandidate(
  db: FirebaseFirestore.Firestore,
  seasonId: string,
  gameCategory: ScoreboardGameId,
  existingCandidates: CsCandidate[],
  afterRank: number
): Promise<CsCandidate | null> {
  // 現在の候補者のlineUserIdリスト（同じ種目）
  const existingIds = new Set(
    existingCandidates
      .filter((c) => c.gameCategory === gameCategory)
      .map((c) => c.lineUserId)
  );

  // 年間スコア集計
  const snap = await db
    .collection("scores")
    .where("seasonId", "==", seasonId)
    .where("gameCategory", "==", gameCategory)
    .get();

  const userMap: Record<string, number> = {};
  for (const doc of snap.docs) {
    const d = doc.data();
    const userId = d.lineUserId as string;
    userMap[userId] = (userMap[userId] || 0) + ((d.totalScore as number) || 0);
  }

  // ランキング順に並べて、既存候補に含まれないユーザーを探す
  const sorted = Object.entries(userMap)
    .sort(([, a], [, b]) => b - a);

  for (let i = 0; i < sorted.length; i++) {
    const [userId, score] = sorted[i];
    const rank = i + 1;
    if (rank <= afterRank) continue; // 辞退者以下のランクのみ
    if (existingIds.has(userId)) continue; // すでに候補者

    // ユーザー情報取得
    const userSnap = await db
      .collection("users")
      .where("lineUserId", "==", userId)
      .limit(1)
      .get();

    const userData = userSnap.empty ? null : userSnap.docs[0].data();

    return {
      lineUserId: userId,
      gameCategory,
      annualRank: rank,
      annualScore: score,
      displayName: userData?.displayName || "ユーザー",
      pictureUrl: userData?.pictureUrl || "",
      status: "promoted",
    };
  }

  return null;
}
