import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth, validateFields, pickAllowedFields } from "@/lib/adminAuth";
import {
  getAllFacilities,
  createFacility,
  updateFacility,
  deleteFacility,
  migrateFallbackToFirestore,
} from "@/lib/facilities";
import type { FacilityType } from "@/types";

export const dynamic = "force-dynamic";

const VALIDATION_RULES = {
  name: { type: "string" as const, minLength: 1, maxLength: 100 },
  calendarId: { type: "string" as const, minLength: 1, maxLength: 300 },
  type: { type: "string" as const },
  capacity: { type: "number" as const, min: 1, max: 1000 },
};

const ALLOWED_UPDATE_FIELDS = [
  "name", "type", "capacity", "calendarId", "active", "order",
  "openTime", "closeTime", "availableDays",
  "minDuration", "fixedDuration", "prepTime",
  "requireTerms", "termsContent",
];

const TIME_REGEX = /^\d{2}:\d{2}$/;

/** openTime / closeTime / availableDays の共通バリデーション */
function validateScheduleFields(body: Record<string, unknown>): string | null {
  const { openTime, closeTime, availableDays } = body;
  if (openTime !== undefined) {
    if (typeof openTime !== "string" || !TIME_REGEX.test(openTime)) {
      return "openTime は HH:MM 形式で指定してください";
    }
  }
  if (closeTime !== undefined) {
    if (typeof closeTime !== "string" || !TIME_REGEX.test(closeTime)) {
      return "closeTime は HH:MM 形式で指定してください";
    }
  }
  if (openTime && closeTime && openTime >= closeTime) {
    return "closeTime は openTime より後に設定してください";
  }
  if (availableDays !== undefined) {
    if (!Array.isArray(availableDays) ||
        availableDays.length === 0 ||
        !availableDays.every((d: unknown) => typeof d === "number" && d >= 0 && d <= 6)) {
      return "availableDays は 0〜6 の数値配列（1件以上）で指定してください";
    }
  }
  return null;
}

/**
 * GET /api/admin/facilities
 * 施設一覧取得（非アクティブ含む）
 * クエリ: ?migrate=true で旧データを Firestore に移行
 */
export async function GET(req: NextRequest) {
  const isAdmin = await checkAdminAuth(req);
  if (!isAdmin) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  // マイグレーション実行（初回のみ）
  const shouldMigrate = req.nextUrl.searchParams.get("migrate") === "true";
  if (shouldMigrate) {
    const count = await migrateFallbackToFirestore();
    if (count > 0) {
      return NextResponse.json({ message: `${count}件の施設を移行しました`, migrated: count });
    }
  }

  const facilities = await getAllFacilities();
  return NextResponse.json({ facilities });
}

/**
 * POST /api/admin/facilities
 * 施設新規作成（カレンダー連携追加）
 */
export async function POST(req: NextRequest) {
  const isAdmin = await checkAdminAuth(req);
  if (!isAdmin) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await req.json();
  const { name, calendarId, type, capacity } = body;

  if (!name || !calendarId || !type || !capacity) {
    return NextResponse.json(
      { error: "name, calendarId, type, capacity は必須です" },
      { status: 400 }
    );
  }

  // type のバリデーション
  if (type !== "meeting_room" && type !== "booth" && type !== "activity") {
    return NextResponse.json(
      { error: "type は 'meeting_room', 'booth', 'activity' のいずれかでなければなりません" },
      { status: 400 }
    );
  }

  const validationError = validateFields(body, VALIDATION_RULES);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const scheduleError = validateScheduleFields(body);
  if (scheduleError) {
    return NextResponse.json({ error: scheduleError }, { status: 400 });
  }

  const facility = await createFacility({
    name,
    calendarId,
    type: type as FacilityType,
    capacity: Number(capacity),
    active: body.active ?? true,
    order: body.order,
    openTime: body.openTime ?? "09:00",
    closeTime: body.closeTime ?? "18:00",
    availableDays: body.availableDays ?? [1, 2, 3, 4, 5],
    minDuration: body.minDuration,
    fixedDuration: body.fixedDuration,
    prepTime: body.prepTime,
    requireTerms: body.requireTerms,
    termsContent: body.termsContent,
  });

  return NextResponse.json({ facility }, { status: 201 });
}

/**
 * PUT /api/admin/facilities
 * 施設更新
 * Body: { id: string, ...更新フィールド }
 */
export async function PUT(req: NextRequest) {
  const isAdmin = await checkAdminAuth(req);
  if (!isAdmin) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await req.json();
  const { id } = body;
  if (!id) {
    return NextResponse.json({ error: "id は必須です" }, { status: 400 });
  }

  // type のバリデーション（指定時のみ）
  if (body.type && body.type !== "meeting_room" && body.type !== "booth") {
    return NextResponse.json(
      { error: "type は 'meeting_room' または 'booth' でなければなりません" },
      { status: 400 }
    );
  }

  const validationError = validateFields(body, VALIDATION_RULES);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const scheduleError = validateScheduleFields(body);
  if (scheduleError) {
    return NextResponse.json({ error: scheduleError }, { status: 400 });
  }

  const updateData = pickAllowedFields(body, ALLOWED_UPDATE_FIELDS);
  if (updateData.capacity) {
    updateData.capacity = Number(updateData.capacity);
  }
  if (updateData.minDuration !== undefined) {
    updateData.minDuration = Number(updateData.minDuration);
  }
  if (updateData.prepTime !== undefined) {
    updateData.prepTime = Number(updateData.prepTime);
  }

  await updateFacility(id, updateData);
  return NextResponse.json({ success: true });
}

/**
 * DELETE /api/admin/facilities
 * 施設削除
 * Body: { id: string }
 */
export async function DELETE(req: NextRequest) {
  const isAdmin = await checkAdminAuth(req);
  if (!isAdmin) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await req.json();
  const { id } = body;
  if (!id) {
    return NextResponse.json({ error: "id は必須です" }, { status: 400 });
  }

  await deleteFacility(id);
  return NextResponse.json({ success: true });
}
