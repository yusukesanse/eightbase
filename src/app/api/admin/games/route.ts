import { NextRequest, NextResponse } from "next/server";
import { getDb, getAllActiveLineUserIds } from "@/lib/firebaseAdmin";
import { checkAdminAuth, validateFields, pickAllowedFields } from "@/lib/adminAuth";
import { broadcastContentPublished } from "@/lib/line";
import { createCalendarEventISO, deleteCalendarEvent } from "@/lib/googleCalendar";
import { FieldValue } from "firebase-admin/firestore";
import type { GameStatus } from "@/types";

export const dynamic = "force-dynamic";

/* ───────── バリデーション ───────── */

const GAME_VALIDATION = {
  title:           { type: "string" as const, minLength: 1, maxLength: 200 },
  category:        { type: "string" as const, minLength: 1, maxLength: 50 },
  description:     { type: "string" as const, minLength: 1, maxLength: 5000 },
  startAt:         { type: "string" as const, maxLength: 50 },
  location:        { type: "string" as const, minLength: 1, maxLength: 200 },
  imageUrl:        { type: "url" as const, maxLength: 2000 },
};

const GAME_UPDATE_FIELDS = [
  "title", "category", "categoryLabel", "description",
  "startAt", "endAt", "location", "imageUrl",
  "maxParticipants", "deadline",
  "published", "scheduledAt", "status",
];

/**
 * GET /api/admin/games — ゲーム一覧（全件）
 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    const snap = await db.collection("games").orderBy("startAt", "desc").get();
    const games = snap.docs.map((doc) => ({
      gameId: doc.id,
      ...doc.data(),
    }));
    return NextResponse.json({ games });
  } catch (error) {
    console.error("[admin/games] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

/**
 * POST /api/admin/games — ゲーム新規作成
 */
export async function POST(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      title, category, categoryLabel, description,
      startAt, endAt, location, imageUrl,
      maxParticipants, deadline,
      published, scheduledAt,
    } = body;

    if (!title || !category || !description || !startAt || !location || !maxParticipants || !deadline) {
      return NextResponse.json({ error: "必須フィールドが不足しています" }, { status: 400 });
    }

    const validationError = validateFields(body, GAME_VALIDATION);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const db = getDb();
    const now = new Date().toISOString();

    const data: Record<string, unknown> = {
      title,
      category,
      description,
      startAt,
      endAt: endAt || null,
      location,
      maxParticipants: Number(maxParticipants),
      deadline,
      status: "upcoming" as GameStatus,
      participantCount: 0,
      published: published ?? false,
      createdAt: now,
      updatedAt: now,
    };
    if (categoryLabel) data.categoryLabel = categoryLabel;
    if (imageUrl) data.imageUrl = imageUrl;
    if (scheduledAt) data.scheduledAt = scheduledAt;

    // Google Calendar 連携（settings からカレンダーIDを取得）
    const settingsDoc = await db.collection("settings").doc("app").get();
    const gameCalendarId = settingsDoc.exists ? (settingsDoc.data()?.gameCalendarId as string) : "";
    if (gameCalendarId) data.calendarId = gameCalendarId;

    if (gameCalendarId && startAt) {
      try {
        const eventId = await createCalendarEventISO(gameCalendarId, {
          summary: `🎮 ${title}`,
          description: description || "",
          startTime: startAt,
          endTime: endAt || startAt,
          location: location || "",
        });
        data.googleEventId = eventId;
      } catch (err) {
        console.error("[admin/games] Calendar create failed:", err);
      }
    }

    const docRef = await db.collection("games").add(data);

    // 公開時は LINE 通知
    if (data.published === true) {
      try {
        const userIds = await getAllActiveLineUserIds();
        await broadcastContentPublished(userIds, "game", title);
      } catch (err) {
        console.error("[admin/games] broadcast failed:", err);
      }
    }

    return NextResponse.json({ success: true, gameId: docRef.id });
  } catch (error) {
    console.error("[admin/games] POST error:", error);
    return NextResponse.json({ error: "作成に失敗しました" }, { status: 500 });
  }
}

/**
 * PUT /api/admin/games — ゲーム更新
 */
export async function PUT(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { gameId } = body;
    if (!gameId || typeof gameId !== "string") {
      return NextResponse.json({ error: "gameId は必須です" }, { status: 400 });
    }

    const fields = pickAllowedFields(body, GAME_UPDATE_FIELDS);
    const validationError = validateFields(fields, GAME_VALIDATION);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const db = getDb();
    const docRef = db.collection("games").doc(gameId);
    const doc = await docRef.get();
    if (!doc.exists) {
      return NextResponse.json({ error: "ゲームが見つかりません" }, { status: 404 });
    }

    if (fields.maxParticipants) {
      fields.maxParticipants = Number(fields.maxParticipants);
    }
    if (fields.scheduledAt === "" || fields.scheduledAt === null) {
      fields.scheduledAt = FieldValue.delete();
    }

    const wasPublished = doc.data()?.published === true;
    await docRef.update({ ...fields, updatedAt: new Date().toISOString() });

    // 下書き→公開への変更時に LINE 通知
    if (!wasPublished && fields.published === true) {
      try {
        const title = fields.title || doc.data()?.title || "新しいゲーム";
        const userIds = await getAllActiveLineUserIds();
        await broadcastContentPublished(userIds, "game", title);
      } catch (err) {
        console.error("[admin/games] broadcast failed:", err);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/games] PUT error:", error);
    return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/games — ゲーム削除
 */
export async function DELETE(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { gameId } = await req.json();
    if (!gameId || typeof gameId !== "string") {
      return NextResponse.json({ error: "gameId は必須です" }, { status: 400 });
    }

    const db = getDb();
    const docRef = db.collection("games").doc(gameId);
    const doc = await docRef.get();

    // Google Calendar イベント削除
    if (doc.exists) {
      const data = doc.data();
      if (data?.googleEventId && data?.calendarId) {
        try {
          await deleteCalendarEvent(data.calendarId, data.googleEventId);
        } catch (err) {
          console.error("[admin/games] Calendar delete failed:", err);
        }
      }
      // サブコレクション（participants）も削除
      const partSnap = await docRef.collection("participants").get();
      const batch = db.batch();
      partSnap.docs.forEach((d) => batch.delete(d.ref));
      batch.delete(docRef);
      await batch.commit();
    } else {
      await docRef.delete();
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/games] DELETE error:", error);
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }
}
