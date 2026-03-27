/**
 * 管理者認証モジュール
 *
 * - httpOnly Cookie（__admin_session）に JWT を格納
 * - CSRF 保護: 状態変更リクエスト（POST/PUT/DELETE）で Origin ヘッダーを検証
 * - 後方互換: Bearer トークンも引き続きサポート
 */

import { type NextRequest, NextResponse } from "next/server";
import { SignJWT, jwtVerify } from "jose";

/* ───────── 定数 ───────── */

const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN ?? "";
const COOKIE_NAME = "__admin_session";
const MAX_AGE = 60 * 60 * 24; // 1日

/** 許可する Origin のリスト（環境変数で上書き可） */
const ALLOWED_ORIGINS: string[] = (() => {
  const envOrigins = process.env.ADMIN_ALLOWED_ORIGINS;
  if (envOrigins) return envOrigins.split(",").map((o) => o.trim());
  // デフォルト: Vercel 本番 + プレビュー + カスタムドメイン
  return [
    "https://nakagawa-share-office-app.vercel.app",
    "https://admin.eightbase.net",
    "https://eightbase.net",
  ];
})();

/* ───────── JWT 秘密鍵（SESSION_SECRET を流用） ───────── */

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET ?? process.env.ADMIN_API_TOKEN ?? "";
  return new TextEncoder().encode(secret);
}

/* ───────── JWT 生成・検証 ───────── */

export async function signAdminToken(): Promise<string> {
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1d")
    .sign(getSecret());
}

export async function verifyAdminToken(token: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload.role === "admin";
  } catch {
    return false;
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
  // サーバーサイドリクエストやツールからの場合はスキップ
  if (!origin) {
    // Referer で補完
    const referer = req.headers.get("referer");
    if (!referer) return true; // ブラウザ外リクエスト（curl など）は Bearer で認証されるため許可
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
 * 3. フォールバック: Bearer トークンを検証
 */
export async function checkAdminAuth(req: NextRequest): Promise<boolean> {
  // CSRF チェック
  if (!checkCsrf(req)) return false;

  // 1. httpOnly Cookie チェック
  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  if (cookie) {
    const valid = await verifyAdminToken(cookie);
    if (valid) return true;
  }

  // 2. Bearer トークンチェック（後方互換）
  if (!ADMIN_TOKEN) return false;
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${ADMIN_TOKEN}`;
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
