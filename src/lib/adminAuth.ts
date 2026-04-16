/**
 * 管理者認証モジュール
 *
 * - httpOnly Cookie（__admin_session）に JWT を格納
 * - Google OAuth で認証されたメールアドレスを JWT に保存
 * - CSRF 保護: 状態変更リクエスト（POST/PUT/DELETE）で Origin ヘッダーを検証
 */

import { type NextRequest, NextResponse } from "next/server";
import { SignJWT, jwtVerify } from "jose";

/* ───────── 定数 ───────── */

const COOKIE_NAME = "__admin_session";
const MAX_AGE = 60 * 60 * 24; // 1日

/**
 * 許可する Origin のリスト
 * ADMIN_DOMAIN / CUSTOMER_DOMAIN から自動生成 + ADMIN_ALLOWED_ORIGINS で追加可能
 */
const ALLOWED_ORIGINS: string[] = (() => {
  const origins: string[] = ["http://localhost:3000"];

  // ドメイン環境変数から自動追加
  const adminDomain = process.env.ADMIN_DOMAIN;
  if (adminDomain) origins.push(`https://${adminDomain}`);
  const customerDomain = process.env.CUSTOMER_DOMAIN;
  if (customerDomain) origins.push(`https://${customerDomain}`);

  // 追加の許可 Origin（カンマ区切り）
  const envOrigins = process.env.ADMIN_ALLOWED_ORIGINS;
  if (envOrigins) {
    envOrigins.split(",").map((o) => o.trim()).forEach((o) => {
      if (o && !origins.includes(o)) origins.push(o);
    });
  }

  return origins;
})();

/* ───────── JWT 秘密鍵（SESSION_SECRET を使用） ───────── */

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET ?? "";
  return new TextEncoder().encode(secret);
}

/* ───────── JWT 生成・検証 ───────── */

/**
 * 管理者 JWT を生成
 * @param email 管理者のメールアドレス
 */
export async function signAdminToken(email: string): Promise<string> {
  return new SignJWT({ role: "admin", email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1d")
    .sign(getSecret());
}

/**
 * 管理者 JWT を検証
 * @returns メールアドレス（有効な場合）、null（無効な場合）
 */
export async function verifyAdminToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.role !== "admin") return null;
    return (payload.email as string) || "admin";
  } catch {
    return null;
  }
}

/* ───────── Cookie ヘルパー ───────── */

export function setAdminCookie(res: NextResponse, jwt: string): void {
  res.cookies.set(COOKIE_NAME, jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  });
}

export function clearAdminCookie(res: NextResponse): void {
  res.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
}

/* ───────── CSRF 検証 ───────── */

function checkCsrf(req: NextRequest): boolean {
  // GET / HEAD は安全メソッド → スキップ
  if (req.method === "GET" || req.method === "HEAD") return true;

  const origin = req.headers.get("origin");

  // Origin ヘッダーがない場合（same-origin fetch は Origin を送る）
  if (!origin) {
    const referer = req.headers.get("referer");
    if (!referer) return true;
    try {
      const refOrigin = new URL(referer).origin;
      return ALLOWED_ORIGINS.some((ao) => ao === refOrigin)
        || refOrigin.endsWith(".vercel.app");
    } catch {
      return false;
    }
  }

  return ALLOWED_ORIGINS.some((ao) => ao === origin)
    || origin.endsWith(".vercel.app");
}

/* ───────── 総合認証チェック ───────── */

/**
 * 管理者認証チェック
 * 1. CSRF ヘッダー検証（POST/PUT/DELETE）
 * 2. httpOnly Cookie の JWT を検証
 *
 * @returns メールアドレス（認証済み）、null（未認証）
 */
export async function checkAdminAuth(req: NextRequest): Promise<string | null> {
  // CSRF チェック
  if (!checkCsrf(req)) return null;

  // httpOnly Cookie チェック
  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  if (cookie) {
    return await verifyAdminToken(cookie);
  }

  return null;
}

/* ───────── 入力バリデーション ───────── */

interface ValidationRule {
  maxLength?: number;
  minLength?: number;
  type?: "string" | "number" | "boolean" | "url";
  min?: number;
  max?: number;
  pattern?: RegExp;
}

interface ValidationRules {
  [field: string]: ValidationRule;
}

/**
 * フィールドのバリデーション
 * 不正なフィールドがあればエラーメッセージを返す。問題なければ null。
 */
export function validateFields(
  data: Record<string, unknown>,
  rules: ValidationRules
): string | null {
  for (const [field, rule] of Object.entries(rules)) {
    const value = data[field];
    if (value === undefined || value === null) continue;

    if (rule.type === "string" || rule.type === "url") {
      if (typeof value !== "string") {
        return `${field} は文字列でなければなりません`;
      }
      if (rule.minLength && value.length < rule.minLength) {
        return `${field} は${rule.minLength}文字以上必要です`;
      }
      if (rule.maxLength && value.length > rule.maxLength) {
        return `${field} は${rule.maxLength}文字以下にしてください`;
      }
      if (rule.type === "url" && value.length > 0) {
        try {
          new URL(value);
        } catch {
          return `${field} は有効なURLでなければなりません`;
        }
      }
      if (rule.pattern && !rule.pattern.test(value)) {
        return `${field} の形式が不正です`;
      }
    }

    if (rule.type === "number") {
      const num = Number(value);
      if (isNaN(num)) {
        return `${field} は数値でなければなりません`;
      }
      if (rule.min !== undefined && num < rule.min) {
        return `${field} は${rule.min}以上にしてください`;
      }
      if (rule.max !== undefined && num > rule.max) {
        return `${field} は${rule.max}以下にしてください`;
      }
    }

    if (rule.type === "boolean") {
      if (typeof value !== "boolean") {
        return `${field} は真偽値でなければなりません`;
      }
    }
  }

  return null;
}

/**
 * ホワイトリストに含まれるフィールドのみ抽出
 */
export function pickAllowedFields(
  data: Record<string, unknown>,
  allowed: string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in data) {
      result[key] = data[key];
    }
  }
  return result;
}
