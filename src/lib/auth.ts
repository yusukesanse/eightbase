/**
 * 利用者認証ヘルパー（portal API 認可の統一窓口）
 *
 * 身分は authorizedUsers.role で表す（"member" | "guest"。role 未設定の既存レコードは member 扱い）。
 *
 * requireGameUser(req):
 *   active なユーザーなら role 不問（member も guest も可）。profileComplete は要求しない。
 *   麻雀リーグ/CS/ランキングなど「ゲーム機能」API で使う（ゲストに開放する対象）。
 *
 * requireMember(req):
 *   active かつ **ゲーム限定 role でない**（＝ゲストを除外）。会員(member)とエイト社員(staff)を許可。
 *   staff は利用範囲を会員同等に拡大済みなので、会員専用の閲覧系 API でも通す。
 *
 * requireMemberProfileComplete(req):
 *   上記に加え profileComplete=true を要求。投稿・予約など会員専用の操作系 API で使う（staff も同じゲート）。
 *
 * requireMemberWithRole(req):
 *   requireMember と同じ可否判定 + role を返す。role でバリデーションを分岐する API（プロフィール登録など）で使う。
 *
 * ゲストに開くゲーム系 API は requireGameUser を明示的に使うこと（既定は安全側＝ゲスト遮断）。
 *
 * いずれもプレビューモードでは GET/HEAD/OPTIONS のみ仮ユーザーを返す（読み取り専用）。
 * 認証バイパス（demo/開発・本番無効）時は固定テストユーザーを通す。
 */

import type { NextRequest } from "next/server";
import { getSessionUserId } from "./session";
import { isPreviewMode, PREVIEW_USER_ID } from "./preview";
import { isGamesOnlyRole, normalizeRole, type UserRole } from "./roles";
import { getDb } from "./firebaseAdmin";

/**
 * authorizedUsers から active=true のレコードを1件引く共通処理。
 * 見つからなければ null（= 未登録 or active=false）。
 */
async function getActiveAuthorizedUser(
  lineUserId: string
): Promise<FirebaseFirestore.DocumentData | null> {
  const db = getDb();
  const snap = await db
    .collection("authorizedUsers")
    .where("lineUserId", "==", lineUserId)
    .where("active", "==", true)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].data();
}

/**
 * session / 認証バイパス / プレビューを解決し、active なユーザーを返す共通プロローグ。
 * - バイパス/プレビューは「仮ユーザー」で user=null（role/profile チェックの対象外＝従来どおり通す）。
 * - 実ユーザーは authorizedUsers の active レコードを user に入れて返す。
 * 解決できなければ null。
 */
async function resolveActiveUser(
  req: NextRequest
): Promise<{ lineUserId: string; user: FirebaseFirestore.DocumentData | null } | null> {
  // プレビューモード: 読み取り専用で仮ユーザー
  if (await isPreviewMode(req)) {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      return { lineUserId: PREVIEW_USER_ID, user: null };
    }
    return null;
  }

  const lineUserId = await getSessionUserId(req);
  if (!lineUserId) return null;

  const user = await getActiveAuthorizedUser(lineUserId);
  if (!user) return null;

  return { lineUserId, user };
}

/**
 * ゲーム限定 role（guest のみ）か。会員専用機能から除外するのに使う。
 * staff は会員同等に拡大したので除外しない（＝会員専用 API も通る）。
 * user=null の仮ユーザー（バイパス/プレビュー）は除外しない（従来どおり通す）。
 */
function isGamesOnly(user: FirebaseFirestore.DocumentData | null): boolean {
  return isGamesOnlyRole(user?.role);
}

/**
 * ゲーム機能用: active なら member/guest/staff いずれも可。profileComplete は要求しない。
 */
export async function requireGameUser(req: NextRequest): Promise<string | null> {
  const r = await resolveActiveUser(req);
  return r ? r.lineUserId : null;
}

/**
 * ゲーム機能用（role も返す版）: 参加費の支払い要否判定（mahjongPaymentRequired）に使う。
 * 仮ユーザー（バイパス/プレビュー・user=null）は role 未設定＝member 扱い。
 */
export async function requireGameUserWithRole(
  req: NextRequest
): Promise<{ lineUserId: string; role: UserRole } | null> {
  const r = await resolveActiveUser(req);
  if (!r) return null;
  return { lineUserId: r.lineUserId, role: normalizeRole(r.user?.role) };
}

/**
 * 会員専用（閲覧系）: active かつゲーム限定 role でない。ゲストを除外し、会員/エイト社員を許可する。
 */
export async function requireMember(req: NextRequest): Promise<string | null> {
  const r = await resolveActiveUser(req);
  if (!r) return null;
  if (isGamesOnly(r.user)) return null;
  return r.lineUserId;
}

/**
 * 会員専用（閲覧系・role も返す版）: requireMember と同じ可否 + role。
 * role でバリデーションや保存内容を分岐する API（プロフィール登録＝会員 3 ステップ / 社員簡素版）で使う。
 * 仮ユーザー（バイパス/プレビュー・user=null）は role 未設定＝member 扱い。
 */
export async function requireMemberWithRole(
  req: NextRequest
): Promise<{ lineUserId: string; role: UserRole } | null> {
  const r = await resolveActiveUser(req);
  if (!r) return null;
  if (isGamesOnly(r.user)) return null;
  return { lineUserId: r.lineUserId, role: normalizeRole(r.user?.role) };
}

/**
 * 会員専用＋プロフィール完了（投稿/予約など操作系）。ゲスト除外＋profileComplete。
 */
export async function requireMemberProfileComplete(
  req: NextRequest
): Promise<string | null> {
  const r = await resolveActiveUser(req);
  if (!r) return null;
  if (isGamesOnly(r.user)) return null;
  // 仮ユーザー(user=null=バイパス/プレビュー)は profileComplete チェック対象外（従来どおり）
  if (r.user && !r.user.profileComplete) return null;
  return r.lineUserId;
}
