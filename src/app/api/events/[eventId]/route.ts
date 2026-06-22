import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireActiveUser } from "@/lib/auth";
import type { NufEvent } from "@/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/events/[eventId]
 * イベントを単体取得する。詳細ページが一覧APIから探さずに済むように用意。
 * 一覧API(/api/events)と同じデータ整形（Firestore Timestamp→ISO、goodCount）を行う。
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const userId = await requireActiveUser(req);
  if (!userId) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { eventId } = await params;
  const doc = await getDb().collection("events").doc(eventId).get();

  if (!doc.exists || doc.data()?.published !== true) {
    return NextResponse.json({ error: "イベントが見つかりません" }, { status: 404 });
  }

  const data = doc.data()!;
  const toISO = (v: unknown): string => {
    if (v && typeof v === "object" && typeof (v as { toDate?: unknown }).toDate === "function") {
      return ((v as { toDate: () => Date }).toDate()).toISOString();
    }
    return String(v ?? "");
  };

  const event = {
    eventId: doc.id,
    ...data,
    startAt: toISO(data.startAt),
    endAt: toISO(data.endAt),
    goodCount: (data as Record<string, unknown>).goodCount ?? 0,
  } as Omit<NufEvent, "eventId"> & { eventId: string; goodCount: number };

  return NextResponse.json(event, { headers: { "Cache-Control": "no-store" } });
}
