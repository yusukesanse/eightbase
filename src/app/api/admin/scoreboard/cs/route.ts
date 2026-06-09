import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import type { ScoreboardGameId } from "@/types";

export const dynamic = "force-dynamic";

const VALID_GAME_IDS: ScoreboardGameId[] = ["mahjong", "poker", "billiards", "darts"];

/**
 * GET /api/admin/scoreboard/cs
 * CSイベント一覧
 * Params: seasonId (optional)
 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    const seasonId = req.nextUrl.searchParams.get("seasonId");

    let query: FirebaseFirestore.Query = db.collection("cs_events").orderBy("createdAt", "desc");
    if (seasonId) {
      query = db.collection("cs_events").where("seasonId", "==", seasonId).orderBy("createdAt", "desc");
    }

    const snap = await query.get();
    const csEvents = snap.docs.map((doc) => ({ csEventId: doc.id, ...doc.data() }));

    return NextResponse.json({ csEvents });
  } catch (error) {
    console.error("[admin/scoreboard/cs] GET error:", error);
    return NextResponse.json({ error: "CS一覧の取得に失敗しました" }, { status: 500 });
  }
}

/**
 * POST /api/admin/scoreboard/cs
 * CSイベント作成
 */
export async function POST(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { seasonId, title, description, startAt, endAt, location } = body;

    if (!seasonId || !title || !startAt || !location) {
      return NextResponse.json(
        { error: "seasonId, title, startAt, location は必須です" },
        { status: 400 }
      );
    }

    const db = getDb();

    // シーズン存在確認
    const seasonDoc = await db.collection("seasons").doc(seasonId).get();
    if (!seasonDoc.exists) {
      return NextResponse.json({ error: "シーズンが見つかりません" }, { status: 404 });
    }

    const now = new Date().toISOString();
    const data = {
      seasonId,
      title,
      description: description || "",
      startAt,
      endAt: endAt || "",
      location,
      status: "draft",
      candidates: [],
      results: [],
      published: false,
      notifiedCandidates: false,
      createdAt: now,
      updatedAt: now,
    };

    const ref = await db.collection("cs_events").add(data);

    return NextResponse.json({ csEventId: ref.id, ...data }, { status: 201 });
  } catch (error) {
    console.error("[admin/scoreboard/cs] POST error:", error);
    return NextResponse.json({ error: "CS作成に失敗しました" }, { status: 500 });
  }
}

/**
 * PUT /api/admin/scoreboard/cs
 * 候補者を年間ランキングから自動抽出
 * Body: { csEventId, seasonId }
 */
export async function PUT(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { csEventId, seasonId } = body;

    if (!csEventId || !seasonId) {
      return NextResponse.json({ error: "csEventId, seasonId は必須です" }, { status: 400 });
    }

    const db = getDb();

    // CSイベント取得
    const csRef = db.collection("cs_events").doc(csEventId);
    const csDoc = await csRef.get();
    if (!csDoc.exists) {
      return NextResponse.json({ error: "CSイベントが見つかりません" }, { status: 404 });
    }

    // シーズン取得（csConfig含む）
    const seasonDoc = await db.collection("seasons").doc(seasonId).get();
    if (!seasonDoc.exists) {
      return NextResponse.json({ error: "シーズンが見つかりません" }, { status: 404 });
    }
    const seasonData = seasonDoc.data()!;
    const csConfig = seasonData.csConfig as Record<ScoreboardGameId, { topN: number }>;

    // 全種目の年間ランキングを取得してCS候補者を抽出
    const allCandidates: {
      lineUserId: string;
      gameCategory: ScoreboardGameId;
      annualRank: number;
      annualScore: number;
    }[] = [];

    for (const gameId of VALID_GAME_IDS) {
      const topN = csConfig?.[gameId]?.topN ?? 3;

      // 年間スコア集計
      const snap = await db
        .collection("scores")
        .where("seasonId", "==", seasonId)
        .where("gameCategory", "==", gameId)
        .get();

      const userMap: Record<string, number> = {};
      for (const doc of snap.docs) {
        const d = doc.data();
        const userId = d.lineUserId as string;
        userMap[userId] = (userMap[userId] || 0) + ((d.totalScore as number) || 0);
      }

      const sorted = Object.entries(userMap)
        .sort(([, a], [, b]) => b - a)
        .slice(0, topN);

      sorted.forEach(([userId, score], idx) => {
        allCandidates.push({
          lineUserId: userId,
          gameCategory: gameId,
          annualRank: idx + 1,
          annualScore: score,
        });
      });
    }

    // ユーザー情報を取得
    const uniqueUserIds = Array.from(new Set(allCandidates.map((c) => c.lineUserId)));
    const userInfoMap: Record<string, { displayName: string; pictureUrl?: string }> = {};

    for (let i = 0; i < uniqueUserIds.length; i += 30) {
      const batch = uniqueUserIds.slice(i, i + 30);
      if (batch.length === 0) continue;
      const usersSnap = await db.collection("users").where("lineUserId", "in", batch).get();
      usersSnap.docs.forEach((d) => {
        const data = d.data();
        userInfoMap[data.lineUserId] = {
          displayName: data.displayName || "ユーザー",
          pictureUrl: data.pictureUrl,
        };
      });
    }

    // CsCandidate配列を構築
    const candidates = allCandidates.map((c) => ({
      lineUserId: c.lineUserId,
      gameCategory: c.gameCategory,
      annualRank: c.annualRank,
      annualScore: c.annualScore,
      displayName: userInfoMap[c.lineUserId]?.displayName ?? "ユーザー",
      pictureUrl: userInfoMap[c.lineUserId]?.pictureUrl ?? "",
      status: "active" as const,
    }));

    await csRef.update({
      candidates,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ candidates, count: candidates.length });
  } catch (error) {
    console.error("[admin/scoreboard/cs] PUT (extract) error:", error);
    return NextResponse.json({ error: "候補者抽出に失敗しました" }, { status: 500 });
  }
}
