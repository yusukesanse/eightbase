import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth, validateFields, pickAllowedFields } from "@/lib/adminAuth";
import {
  getAllFacilities,
  createFacility,
  updateFacility,
  deleteFacility,
  migrateFallbackToFirestore,
} from "@/lib/facilities";
import {
  saveFacilitySquareSecrets,
  clearFacilitySquareSecrets,
  getFacilitySquareStatusMap,
  isSecretsKeyConfigured,
  SECRETS_KEY_MISSING_MESSAGE,
  type SquareEnvironmentName,
} from "@/lib/facilitySecrets";
import { MAX_COMPANIONS } from "@/lib/companions";
import { BOOKING_HORIZON_DAYS } from "@/lib/reservations";
import type { FacilityType } from "@/types";

export const dynamic = "force-dynamic";

const VALIDATION_RULES = {
  name: { type: "string" as const, minLength: 1, maxLength: 100 },
  calendarId: { type: "string" as const, minLength: 1, maxLength: 300 },
  type: { type: "string" as const },
  capacity: { type: "number" as const, min: 1, max: 1000 },
  // ── 決済 / 解錠 ──
  paymentAmount: { type: "number" as const, min: 0, max: 10000000 },
  switchBotDeviceId: { type: "string" as const, maxLength: 100 },
  // ── 同伴者（0 = 同伴者必須OFF。ONなら下の validateCompanionFields で 2 以上を強制） ──
  minPartySize: { type: "number" as const, min: 0, max: 20 },
  // ── 直前予約の禁止（0 = 制限なし）。利用日の何日前までに予約が必要か ──
  //    上限は予約可能期間（クライアントの 30日先まで）より小さくしないと予約できる日が無くなる。
  minAdvanceDays: { type: "number" as const, min: 0, max: 29 },
  // Square認証情報（facilitySecrets へ暗号化保存。facilities ドキュメントには入れない）
  squareAccessToken: { type: "string" as const, maxLength: 300 },
  squareLocationId: { type: "string" as const, maxLength: 100 },
};

// ⚠️ squareAccessToken / squareLocationId をここに追加しないこと（facilities ドキュメントに漏れる）。
const ALLOWED_UPDATE_FIELDS = [
  "name", "type", "capacity", "calendarId", "active", "order",
  "openTime", "closeTime", "availableDays",
  "minDuration", "fixedDuration", "prepTime", "minAdvanceDays",
  "requireTerms", "termsContent",
  "requirePayment", "hourlyRate",
  "paymentAmount", "switchBotDeviceId",
  "requireCompanions", "minPartySize",
];

/** Square認証情報の入力（clear=登録削除）。値はログに出さないこと。 */
type SquareSecretsInput =
  | { clear: true }
  | { clear?: false; accessToken?: string; locationId?: string; environment?: SquareEnvironmentName }
  | null;

/**
 * リクエストボディから Square 認証情報の更新指示を取り出す。
 * 空文字は「変更しない」。token/locationId を保存する場合は FACILITY_SECRETS_KEY が必須。
 */
function extractSquareSecretsInput(
  body: Record<string, unknown>
): { input: SquareSecretsInput; error?: string } {
  const environment = body.squareEnvironment;
  if (environment !== undefined && environment !== "production" && environment !== "sandbox") {
    return { input: null, error: "squareEnvironment は production / sandbox のいずれかで指定してください" };
  }
  if (body.clearSquareCredentials === true) {
    return { input: { clear: true } };
  }
  const accessToken =
    typeof body.squareAccessToken === "string" ? body.squareAccessToken.trim() : "";
  const locationId =
    typeof body.squareLocationId === "string" ? body.squareLocationId.trim() : "";
  if (!accessToken && !locationId && environment === undefined) {
    return { input: null };
  }
  if ((accessToken || locationId) && !isSecretsKeyConfigured()) {
    return { input: null, error: SECRETS_KEY_MISSING_MESSAGE };
  }
  return {
    input: {
      accessToken: accessToken || undefined,
      locationId: locationId || undefined,
      environment: environment as SquareEnvironmentName | undefined,
    },
  };
}

/** requirePayment=true なのに決済額が無い保存を弾く（チェックの意味を保証する）。 */
function validatePaymentFields(body: Record<string, unknown>): string | null {
  if (body.requirePayment === true && !(Number(body.paymentAmount) > 0)) {
    return "Square決済を必須にする場合は決済額（1円以上）を入力してください";
  }
  return null;
}

/**
 * 直前予約の禁止日数（minAdvanceDays）が不正な保存を弾く。
 * 予約可能期間（BOOKING_HORIZON_DAYS 日先まで）以上にすると予約できる日が1日も無くなるため上限を設ける。
 * ※ VALIDATION_RULES にも同じ範囲を書いているが、こちらは理由の分かる文言を返すための明示チェック。
 */
function validateAdvanceFields(body: Record<string, unknown>): string | null {
  if (body.minAdvanceDays === undefined || body.minAdvanceDays === null) return null;
  const days = Number(body.minAdvanceDays);
  if (!Number.isInteger(days) || days < 0) {
    return "「何日前までに予約が必要か」は0以上の整数で入力してください（0=制限なし）";
  }
  if (days >= BOOKING_HORIZON_DAYS) {
    return `「何日前までに予約が必要か」は${BOOKING_HORIZON_DAYS - 1}日以下にしてください（予約できるのは${BOOKING_HORIZON_DAYS}日先までのため）`;
  }
  return null;
}

/**
 * requireCompanions=true なのに最低合計人数が不正な保存を弾く。
 * 最低合計人数は予約者本人を含むので 2 未満（＝1人で予約できる）は設定として矛盾する。
 * 収容人数より大きいと誰も予約できなくなるのでこれも弾く。
 * 同伴者は MAX_COMPANIONS 名までしか選べないので、それを超える最低人数も「誰も予約できない」設定になる。
 */
function validateCompanionFields(body: Record<string, unknown>): string | null {
  if (body.requireCompanions !== true) return null;
  const min = Number(body.minPartySize);
  if (!Number.isInteger(min) || min < 2) {
    return "同伴者を必須にする場合は最低合計人数（2名以上）を入力してください";
  }
  // 予約者本人＋同伴者 MAX_COMPANIONS 名が上限。ここを超えると同伴者を選び切れず
  // 予約が永久に成立しない（`maxCompanionsOf` が MAX_COMPANIONS で頭打ちになるため）。
  if (min - 1 > MAX_COMPANIONS) {
    return `同伴者の上限が${MAX_COMPANIONS}名のため、最低合計人数は${MAX_COMPANIONS + 1}名以下にしてください`;
  }
  const capacity = Number(body.capacity);
  if (Number.isFinite(capacity) && capacity > 0 && min > capacity) {
    return "最低合計人数は収容人数以下にしてください";
  }
  return null;
}

/** 施設保存後に Square 認証情報の更新指示を適用する。 */
async function applySquareSecrets(facilityId: string, input: SquareSecretsInput): Promise<void> {
  if (!input) return;
  if (input.clear) {
    await clearFacilitySquareSecrets(facilityId);
    return;
  }
  await saveFacilitySquareSecrets(facilityId, input);
}

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
  // Square設定の「状態」だけを付与（トークン等の実値は返さない）
  const squareStatusMap = await getFacilitySquareStatusMap(facilities.map((f) => f.id));
  return NextResponse.json({
    facilities: facilities.map((f) => ({
      ...f,
      square: squareStatusMap[f.id] ?? { configured: false },
    })),
    squareKeyConfigured: isSecretsKeyConfigured(),
  });
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

  const paymentError = validatePaymentFields(body);
  if (paymentError) {
    return NextResponse.json({ error: paymentError }, { status: 400 });
  }

  const advanceError = validateAdvanceFields(body);
  if (advanceError) {
    return NextResponse.json({ error: advanceError }, { status: 400 });
  }

  const companionError = validateCompanionFields(body);
  if (companionError) {
    return NextResponse.json({ error: companionError }, { status: 400 });
  }

  const { input: squareSecretsInput, error: squareSecretsError } = extractSquareSecretsInput(body);
  if (squareSecretsError) {
    return NextResponse.json({ error: squareSecretsError }, { status: 400 });
  }

  try {
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
      // 直前予約の禁止。0/未指定はフィールドを作らない（既存施設と doc 形状を揃える）
      minAdvanceDays: Number(body.minAdvanceDays) > 0 ? Number(body.minAdvanceDays) : undefined,
      requireTerms: body.requireTerms,
      termsContent: body.termsContent,
      requirePayment: body.requirePayment,
      hourlyRate: body.hourlyRate ? Number(body.hourlyRate) : undefined,
      // トレーラー等: 決済額 / 解錠デバイス（新規作成でも保存する）
      paymentAmount: body.paymentAmount ? Number(body.paymentAmount) : undefined,
      switchBotDeviceId: body.switchBotDeviceId || undefined,
      // サウナ等: 同伴者必須（OFFなら両方 undefined でフィールドを作らない）
      requireCompanions: body.requireCompanions === true ? true : undefined,
      minPartySize:
        body.requireCompanions === true ? Number(body.minPartySize) : undefined,
    });
    await applySquareSecrets(facility.id, squareSecretsInput);
    return NextResponse.json({ facility }, { status: 201 });
  } catch (error) {
    console.error("[admin/facilities] POST error:", error);
    return NextResponse.json({ error: "施設の作成に失敗しました" }, { status: 500 });
  }
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
  if (body.type && body.type !== "meeting_room" && body.type !== "booth" && body.type !== "activity") {
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

  const paymentError = validatePaymentFields(body);
  if (paymentError) {
    return NextResponse.json({ error: paymentError }, { status: 400 });
  }

  const advanceError = validateAdvanceFields(body);
  if (advanceError) {
    return NextResponse.json({ error: advanceError }, { status: 400 });
  }

  const companionError = validateCompanionFields(body);
  if (companionError) {
    return NextResponse.json({ error: companionError }, { status: 400 });
  }

  const { input: squareSecretsInput, error: squareSecretsError } = extractSquareSecretsInput(body);
  if (squareSecretsError) {
    return NextResponse.json({ error: squareSecretsError }, { status: 400 });
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
  if (updateData.hourlyRate !== undefined) {
    updateData.hourlyRate = Number(updateData.hourlyRate);
  }
  if (updateData.minPartySize !== undefined) {
    updateData.minPartySize = Number(updateData.minPartySize);
  }
  if (updateData.minAdvanceDays !== undefined) {
    updateData.minAdvanceDays = Number(updateData.minAdvanceDays);
  }

  try {
    await updateFacility(id, updateData);
    await applySquareSecrets(id, squareSecretsInput);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/facilities] PUT error:", error);
    return NextResponse.json({ error: "施設の更新に失敗しました" }, { status: 500 });
  }
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
  // 施設に紐づくSquare認証情報も残さない
  await clearFacilitySquareSecrets(id).catch((e) =>
    console.error("[admin/facilities] secrets cleanup failed:", e instanceof Error ? e.message : "error")
  );
  return NextResponse.json({ success: true });
}
