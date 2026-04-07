import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import type { Quest, UserQuestProgress } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const userId = req.headers.get("x-line-user-id") ?? "";
  const db = getDb();

  // 公開済みクエストのみ取得
  const questsSnap = await db
    .collection("quests")
    .where("published", "==", true)
    .get();

  // ログインユーザーの場合のみ進捗を取得
  let progressMap = new Map<string, UserQuestProgress>();
  let totalPoints = 0;

  if (userId) {
    const [progressSnap, userDoc] = await Promise.all([
      db.collection("users").doc(userId).collection("questProgress").get(),
      db.collection("users").doc(userId).get(),
    ]);
    progressSnap.docs.forEach((doc) => {
      progressMap.set(doc.id, doc.data() as UserQuestProgress);
    });
    totalPoints = userDoc.exists ? (userDoc.data()?.points ?? 0) : 0;
  }

  const quests = questsSnap.docs.map((doc) => {
    const data = doc.data() as Omit<Quest, "questId">;
    return {
      questId: doc.id,
      ...data,
      progress: userId ? progressMap.get(doc.id) : undefined,
      goodCount: (data as Record<string, unknown>).goodCount ?? 0,
    };
  });

  return NextResponse.json({ quests, totalPoints });
}
