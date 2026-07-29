/**
 * 同伴者（サウナ等・1人での利用を禁止する施設）の検証。
 *
 * クライアントの「予約ボタンが押せない」は UX でしかない。同伴者の資格（active・ゲスト以外）と
 * 最低人数はここでサーバー側が必ず再検証する。
 *
 * 設計上の約束:
 * - 同伴者必須OFFの施設かつ同伴者0件なら **Firestore に一切触れない**（既存施設の読み取りを1件も増やさない）。
 * - `authorizedUsers` の絞り込みに `in` + `==` を重ねない（複合インデックスを増やさない）。
 *   active / role は取得後にメモリで判定する。
 *
 * 空き判定（reservationLocks / assertSlotFreeInTx）とは独立。ここでは時間の重なりを一切見ない。
 */

import { normalizeRole } from "./roles";
import type { Facility, ReservationCompanion } from "@/types";

export type CompanionValidationReason =
  | "COMPANION_NOT_ALLOWED" // 同伴者非対応の施設に同伴者が指定された
  | "COMPANION_INVALID"     // 未登録 / active=false / ゲスト
  | "COMPANION_SELF"        // 予約者自身が同伴者に混ざっている
  | "COMPANION_REQUIRED"    // 最低合計人数に足りない
  | "COMPANION_TOO_MANY";   // 収容人数・上限を超える

export interface CompanionValidationOk {
  ok: true;
  companions: ReservationCompanion[];
  companionIds: string[];
  /** 合計人数 = 1（予約者本人）+ 同伴者数 */
  partySize: number;
  /** 予約者の表示名（同伴者の解決と同じクエリで引くので追加読み取りは発生しない） */
  organizerName?: string;
}

export interface CompanionValidationNg {
  ok: false;
  reason: CompanionValidationReason;
  message: string;
  /** COMPANION_INVALID のとき、クライアントが選択を解除できるように該当IDを返す */
  invalidIds?: string[];
}

export type CompanionValidationResult = CompanionValidationOk | CompanionValidationNg;

/** 同伴者数の上限。Firestore の `in` クエリ上限(30)に予約者本人を足しても収まる値にしておく。 */
export const MAX_COMPANIONS = 9;

/** 同伴者必須施設の既定の最低合計人数（予約者本人を含む） */
export const DEFAULT_MIN_PARTY_SIZE = 2;

type CompanionFacility = Pick<
  Facility,
  "requireCompanions" | "minPartySize" | "capacity"
>;

/** 施設に設定された最低合計人数（予約者本人を含む）。 */
export function minPartySizeOf(facility: CompanionFacility): number {
  const v = facility.minPartySize;
  return typeof v === "number" && v >= DEFAULT_MIN_PARTY_SIZE ? v : DEFAULT_MIN_PARTY_SIZE;
}

/** 指定できる同伴者の上限人数（＝合計人数の上限 - 予約者本人）。 */
export function maxCompanionsOf(facility: CompanionFacility): number {
  const byCapacity =
    typeof facility.capacity === "number" && facility.capacity > 0
      ? facility.capacity - 1
      : MAX_COMPANIONS;
  return Math.max(1, Math.min(MAX_COMPANIONS, byCapacity));
}

/**
 * リクエストの同伴者IDを正規化する。
 * 重複は **人数を数える前に** 落とす（同じ人を2回選んで最低人数を満たせないようにする）。
 */
export function normalizeCompanionIds(
  raw: unknown,
  selfLineUserId: string
): { ok: true; ids: string[] } | CompanionValidationNg {
  if (raw === undefined || raw === null) return { ok: true, ids: [] };
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      reason: "COMPANION_INVALID",
      message: "一緒に入る人の指定が不正です。選び直してください。",
    };
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") {
      return {
        ok: false,
        reason: "COMPANION_INVALID",
        message: "一緒に入る人の指定が不正です。選び直してください。",
      };
    }
    const id = item.trim();
    if (!id) {
      return {
        ok: false,
        reason: "COMPANION_INVALID",
        message: "一緒に入る人の指定が不正です。選び直してください。",
      };
    }
    if (id === selfLineUserId) {
      return {
        ok: false,
        reason: "COMPANION_SELF",
        message: "ご自身は一緒に入る人に含められません。",
      };
    }
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return { ok: true, ids };
}

/**
 * 施設設定に対する人数チェック。
 * 同伴者非対応の施設に同伴者が来た場合はサイレント無視せず弾く
 * （黙って捨てると UI との不整合に本番で気づけない）。
 */
export function checkPartySize(
  facility: CompanionFacility,
  companionCount: number
): { ok: true } | CompanionValidationNg {
  const required = facility.requireCompanions === true;

  if (!required) {
    if (companionCount > 0) {
      return {
        ok: false,
        reason: "COMPANION_NOT_ALLOWED",
        message: "この施設は一緒に入る人の指定に対応していません。",
      };
    }
    return { ok: true };
  }

  const min = minPartySizeOf(facility);
  const partySize = 1 + companionCount;
  if (partySize < min) {
    return {
      ok: false,
      reason: "COMPANION_REQUIRED",
      message: `この施設は1人ではご利用いただけません。一緒に入る人を${min - 1}名以上選んでください。`,
    };
  }

  const max = maxCompanionsOf(facility);
  if (companionCount > max) {
    return {
      ok: false,
      reason: "COMPANION_TOO_MANY",
      message: `一緒に入る人は最大${max}名までです。`,
    };
  }

  return { ok: true };
}

/**
 * Google カレンダーの説明欄に足す行。同伴者が居なければ空文字を返すので、
 * 既存施設のイベント本文は従来どおりになる。
 */
export function buildCompanionCalendarLines(
  companions: Pick<ReservationCompanion, "displayName">[],
  partySize: number
): string {
  if (companions.length === 0) return "";
  const names = companions.map((c) => c.displayName).join("、");
  return `\n同伴者: ${names}\n合計人数: ${partySize}名`;
}

/**
 * 同伴者を検証し、保存用のスナップショットを組み立てる。予約 POST（通常/決済）の両方から呼ぶ。
 *
 * ⚠️ トランザクションの外で呼ぶこと。空き判定 transaction の中に入れると
 * assertSlotFreeInTx の読み取りと競合してリトライ確率とレイテンシが上がる。
 * 同伴者の active が確定直前に変わるレースはダブルブッキングと違い実害が小さいので、
 * 空き判定の原子性を優先する。
 */
export async function validateCompanionsForReservation(
  db: FirebaseFirestore.Firestore,
  facility: CompanionFacility,
  selfLineUserId: string,
  rawCompanionIds: unknown
): Promise<CompanionValidationResult> {
  const normalized = normalizeCompanionIds(rawCompanionIds, selfLineUserId);
  if (!normalized.ok) return normalized;
  const ids = normalized.ids;

  // 既存施設（同伴者必須OFF・同伴者なし）はここで抜ける = Firestore 読み取りの増加ゼロ
  if (facility.requireCompanions !== true && ids.length === 0) {
    return { ok: true, companions: [], companionIds: [], partySize: 1 };
  }

  const sizeCheck = checkPartySize(facility, ids.length);
  if (!sizeCheck.ok) return sizeCheck;

  if (ids.length === 0) {
    return { ok: true, companions: [], companionIds: [], partySize: 1 };
  }

  // 同伴者と予約者本人を1クエリでまとめて引く（organizerName の解決に追加読み取りを発生させない）。
  // `active` を where に足すと `in` + `==` の複合インデックスが要るので、判定はメモリで行う。
  const snap = await db
    .collection("authorizedUsers")
    .where("lineUserId", "in", [...ids, selfLineUserId])
    .get();

  const nameById = new Map<string, string>();
  for (const doc of snap.docs) {
    const d = doc.data();
    const id: string = typeof d.lineUserId === "string" ? d.lineUserId : "";
    if (!id) continue;
    if (d.active !== true) continue;
    if (normalizeRole(d.role) === "guest") continue;
    // 同一 lineUserId の doc が複数ある場合（招待の再発行など）は、有効な doc が1件でもあれば通す
    if (nameById.has(id)) continue;
    nameById.set(id, typeof d.displayName === "string" ? d.displayName : "");
  }

  const invalidIds = ids.filter((id) => !nameById.has(id));
  if (invalidIds.length > 0) {
    return {
      ok: false,
      reason: "COMPANION_INVALID",
      message: "選択した方の一部は現在ご利用いただけません。選び直してください。",
      invalidIds,
    };
  }

  const companions: ReservationCompanion[] = ids.map((id) => ({
    lineUserId: id,
    displayName: nameById.get(id) || "",
  }));

  return {
    ok: true,
    companions,
    companionIds: ids,
    partySize: 1 + companions.length,
    organizerName: nameById.get(selfLineUserId) || undefined,
  };
}

/**
 * 予約ドキュメントに載せる同伴者フィールド。
 * 同伴者が居なければ **空オブジェクト** を返す＝既存予約と doc の形状が完全に一致する。
 */
export function companionReservationFields(
  result: CompanionValidationOk,
  organizerName?: string
): Partial<{
  companions: ReservationCompanion[];
  companionIds: string[];
  partySize: number;
  organizerName: string;
}> {
  if (result.companions.length === 0) return {};
  const name = organizerName || result.organizerName;
  return {
    companions: result.companions,
    companionIds: result.companionIds,
    partySize: result.partySize,
    ...(name ? { organizerName: name } : {}),
  };
}
