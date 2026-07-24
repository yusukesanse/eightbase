/**
 * 施設ごとの Square 認証情報（アクセストークン / ロケーションID）の保管
 *
 * 取り扱い規約（超機密のため厳守）:
 * - facilities ドキュメントには一切保存しない（公開API/管理API/クライアントキャッシュへ漏れないよう分離）。
 * - 保存先は facilitySecrets/{facilityId}。Admin SDK 経由のサーバー専用コレクション。
 * - 値は FACILITY_SECRETS_KEY（32バイト鍵・base64/hex）で AES-256-GCM 暗号化して保存する。
 * - 復号値を API レスポンス・ログ・監査ログに出さない。管理画面の表示はロケーションID下4桁のみ。
 * - 鍵未設定時: 保存は明示エラー、読み取りは null（＝従来の環境変数 SQUARE_* にフォールバック）。
 */
import crypto from "crypto";
import { getDb } from "@/lib/firebaseAdmin";
import type { FacilitySquareStatus } from "@/types";

const COLLECTION = "facilitySecrets";

export type SquareEnvironmentName = "production" | "sandbox";

export interface FacilitySquareCredentials {
  accessToken: string;
  locationId: string;
  environment: SquareEnvironmentName;
}

function loadKey(): Buffer | null {
  const raw = process.env.FACILITY_SECRETS_KEY;
  if (!raw) return null;
  for (const enc of ["base64", "hex"] as const) {
    try {
      const buf = Buffer.from(raw, enc);
      if (buf.length === 32) return buf;
    } catch {
      /* 次の形式を試す */
    }
  }
  return null;
}

/** FACILITY_SECRETS_KEY が有効（32バイト鍵）かどうか。 */
export function isSecretsKeyConfigured(): boolean {
  return loadKey() !== null;
}

export const SECRETS_KEY_MISSING_MESSAGE =
  "FACILITY_SECRETS_KEY が未設定のため保存できません。`openssl rand -base64 32` で生成した鍵を環境変数に設定してください。";

/** AES-256-GCM で暗号化。保存形式: v1:<iv>:<authTag>:<ciphertext>（各base64） */
export function encryptSecret(plain: string): string {
  const key = loadKey();
  if (!key) throw new Error(SECRETS_KEY_MISSING_MESSAGE);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

/** encryptSecret の逆変換。改ざん（GCMタグ不一致）や鍵違いはエラー。 */
export function decryptSecret(stored: string): string {
  const key = loadKey();
  if (!key) throw new Error("FACILITY_SECRETS_KEY が未設定です");
  const [version, ivB64, tagB64, ctB64] = stored.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !ctB64) {
    throw new Error("暗号化データの形式が不正です");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Square 認証情報を保存（部分更新）。
 * accessToken / locationId は非空のときのみ上書き（空=変更しない）。environment は指定時のみ更新。
 */
export async function saveFacilitySquareSecrets(
  facilityId: string,
  input: {
    accessToken?: string;
    locationId?: string;
    environment?: SquareEnvironmentName;
  }
): Promise<void> {
  const update: Record<string, string> = { updatedAt: new Date().toISOString() };
  if (input.accessToken) {
    update.squareAccessTokenEnc = encryptSecret(input.accessToken);
  }
  if (input.locationId) {
    update.squareLocationIdEnc = encryptSecret(input.locationId);
    // 下4桁だけは平文メタデータとして持つ（管理画面の識別表示用・非機密）
    update.squareLocationIdLast4 = input.locationId.slice(-4);
  }
  if (input.environment) {
    update.squareEnvironment = input.environment;
  }
  await getDb().collection(COLLECTION).doc(facilityId).set(update, { merge: true });
}

/** Square 認証情報を全削除（施設削除時・明示クリア時）。 */
export async function clearFacilitySquareSecrets(facilityId: string): Promise<void> {
  await getDb().collection(COLLECTION).doc(facilityId).delete();
}

/**
 * 決済リンク生成/取引照合に使う復号済み認証情報を返す。
 * 未登録・鍵未設定・復号失敗は null（呼び出し側は環境変数 SQUARE_* にフォールバック）。
 * ※ログに復号値・暗号文を出さないこと。
 */
export async function getFacilitySquareCredentials(
  facilityId: string
): Promise<FacilitySquareCredentials | null> {
  const snap = await getDb().collection(COLLECTION).doc(facilityId).get();
  if (!snap.exists) return null;
  const data = snap.data() as
    | {
        squareAccessTokenEnc?: string;
        squareLocationIdEnc?: string;
        squareEnvironment?: SquareEnvironmentName;
      }
    | undefined;
  if (!data?.squareAccessTokenEnc || !data?.squareLocationIdEnc) return null;
  if (!isSecretsKeyConfigured()) {
    console.warn(`[facilitySecrets] FACILITY_SECRETS_KEY 未設定のため施設(${facilityId})のSquare設定を復号できません`);
    return null;
  }
  try {
    return {
      accessToken: decryptSecret(data.squareAccessTokenEnc),
      locationId: decryptSecret(data.squareLocationIdEnc),
      environment: data.squareEnvironment === "sandbox" ? "sandbox" : "production",
    };
  } catch (e) {
    console.error(
      `[facilitySecrets] 施設(${facilityId})のSquare設定の復号に失敗しました:`,
      e instanceof Error ? e.message : "error"
    );
    return null;
  }
}

/** 管理画面表示用の状態（秘密値は含まない）を施設IDごとにまとめて返す。 */
export async function getFacilitySquareStatusMap(
  facilityIds: string[]
): Promise<Record<string, FacilitySquareStatus>> {
  const result: Record<string, FacilitySquareStatus> = {};
  if (facilityIds.length === 0) return result;
  const db = getDb();
  const snaps = await db.getAll(...facilityIds.map((id) => db.collection(COLLECTION).doc(id)));
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const data = snap.data() as {
      squareAccessTokenEnc?: string;
      squareLocationIdEnc?: string;
      squareLocationIdLast4?: string;
      squareEnvironment?: SquareEnvironmentName;
      updatedAt?: string;
    };
    result[snap.id] = {
      configured: !!(data.squareAccessTokenEnc && data.squareLocationIdEnc),
      environment: data.squareEnvironment === "sandbox" ? "sandbox" : "production",
      locationIdLast4: data.squareLocationIdLast4,
      updatedAt: data.updatedAt,
    };
  }
  return result;
}
