import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireActiveUser } from "@/lib/auth";
import type { NufEvent } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const userId = await requireActiveUser(req);
  if (!userId) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const db = getDb();

  const snap = await db
    .collection("events")
    .where("published", "==", true)
    .orderBy("startAt", "asc")
    .get();

  const events = snap.docs.map((doc) => {
    const data = doc.data();

    // Firestore Timestamp → ISO文字列に変換（文字列ならそのまま）
    const toISO = (v: unknown): string => {
      if (v && typeof v === "object" && typeof (v as { toDate?: unknown }).toDate === "function") {
        return ((v as { toDate: () => Date }).toDate()).toISOString();
      }
      return String(v ?? "");
    };

    return {
      eventId: doc.id,
      ...data,
      startAt: toISO(data.startAt),
      endAt: toISO(data.endAt),
      goodCount: (data as Record<string, unknown>).goodCount ?? 0,
    } as Omit<NufEvent, "eventId"> & { eventId: string; goodCount: number };
  });

  // HTTP層ではキャッシュさせず常に最新を返す。鮮度管理はクライアントの
  // 軽量キャッシュ(useStaleWhileRevalidate)側で行う。
  return NextResponse.json({ events }, { headers: { "Cache-Control": "no-store" } });
}
