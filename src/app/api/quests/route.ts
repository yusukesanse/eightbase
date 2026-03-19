import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import type { Quest, UserQuestProgress } from "@/types";

export async function GET(req: NextRequest) {
  const userId = req.headers.get("x-line-user-id");
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();

  // クエスト一覧と進捗を並行取得
  const [questsSnap, progressSnap, userDoc] = await Promise.all([
    db.collection("quests").get(),
    db.collection("users").doc(userId).collection("questProgress").get(),
    db.collection("users").doc(userId).get(),
  ]);

  const progressMap = new Map<string, UserQuestProgress>();
  progressSnap.docs.forEach((doc) => {
    progressMap.set(doc.id, doc.data() as UserQuestProgress);
  });

  const quests = questsSnap.docs.map((doc) => ({
    questId: doc.id,
    ...(doc.data() as Omit<Quest, "questId">),
    progress: progressMap.get(doc.id),
  }));

  const totalPoints = userDoc.exists ? (userDoc.data()?.points ?? 0) : 0;

  return NextResponse.json({ quests, totalPoints });
}
