import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import type { NufEvent } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const userId = req.headers.get("x-line-user-id") ?? "";
  const db = getDb();

  const snap = await db
    .collection("events")
    .where("published", "==", true)
    .orderBy("startAt", "asc")
    .get();

  // イベントごとのグッド数とユーザーのグッド状態を並行取得
  const events = await Promise.all(
    snap.docs.map(async (doc) => {
      const data = doc.data() as Omit<NufEvent, "eventId">;
      const goodsSnap = await db
        .collection("events")
        .doc(doc.id)
        .collection("goods")
        .get();

      const goodCount = goodsSnap.size;
      const liked = userId
        ? goodsSnap.docs.some((d) => d.id === userId)
        : false;

      return {
        eventId: doc.id,
        ...data,
        goodCount,
        liked,
      };
    })
  );

  return NextResponse.json({ events });
}
