import { NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import type { NufEvent } from "@/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  const snap = await db
    .collection("events")
    .where("published", "==", true)
    .orderBy("startAt", "asc")
    .get();

  const events: NufEvent[] = snap.docs.map((doc) => ({
    eventId: doc.id,
    ...(doc.data() as Omit<NufEvent, "eventId">),
  }));

  return NextResponse.json({ events });
}
