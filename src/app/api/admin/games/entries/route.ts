import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/adminAuth";
import { addGameEntryByAdmin } from "@/lib/adminGameEntry";
import { isPaymentGame } from "@/lib/gameEntryPayment";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return !Number.isNaN(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

export async function POST(req: NextRequest) {
  const admin = await checkAdminAuth(req);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => null);
    const gameCategory: unknown = body?.gameCategory;
    const eventDate: unknown = body?.eventDate;
    const lineUserId: unknown = body?.lineUserId;

    if (!isPaymentGame(gameCategory)) {
      return NextResponse.json({ error: "gameCategory が不正です" }, { status: 400 });
    }
    if (!isRealDate(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }
    if (typeof lineUserId !== "string" || !lineUserId) {
      return NextResponse.json({ error: "lineUserId が不正です" }, { status: 400 });
    }

    const result = await addGameEntryByAdmin({
      game: gameCategory,
      seasonId: typeof body?.seasonId === "string" ? body.seasonId : undefined,
      eventDate,
      lineUserId,
      markPaid: body?.markPaid !== false,
      admin,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status }
      );
    }

    return NextResponse.json(
      {
        entry: result.entry,
        previousStatus: result.previousStatus,
        rosterUpdated: result.rosterUpdated,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[admin/games/entries] POST error:", error);
    return NextResponse.json({ error: "追加に失敗しました" }, { status: 500 });
  }
}
