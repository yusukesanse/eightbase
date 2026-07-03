#!/usr/bin/env node
/**
 * ビルド前環境変数チェック（package.json の "prebuild" から実行）。
 *
 * 目的: demo の値が混入したまま *本番ビルドが成功してしまう* のを防ぐ。
 * - APP_ENV=production: 不備・demo値混入を検出したら exit 1 でビルドを失敗させる。
 * - APP_ENV=demo / local: 警告のみ（exit 0）。手元ビルドや demo を妨げない。
 *
 * NEXT_PUBLIC_APP_ENV を環境の真実とする（src/lib/env.ts と同じ規約）。
 */

const env = process.env;
const appEnv = (env.NEXT_PUBLIC_APP_ENV || "local").toLowerCase();

const errors = [];
const warnings = [];

/** 本番ドメインではない URL か */
function looksNonProdUrl(url) {
  return (
    !url ||
    url.includes("vercel.app") ||
    url.includes("localhost") ||
    url.includes("127.0.0.1") ||
    url.startsWith("http://")
  );
}

// すべての環境で最低限必要なキー
const REQUIRED = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_STORAGE_BUCKET",
  "SESSION_SECRET",
  "NEXT_PUBLIC_LIFF_ID",
];

for (const key of REQUIRED) {
  if (!env[key]) {
    (appEnv === "production" ? errors : warnings).push(`${key} が未設定です`);
  }
}

// SESSION_SECRET の最低長
if (env.SESSION_SECRET && env.SESSION_SECRET.length < 32) {
  (appEnv === "production" ? errors : warnings).push(
    "SESSION_SECRET は 32 文字以上が必要です"
  );
}

// EXPECTED_FIREBASE_PROJECT_ID との突合（設定時のみ・全環境で強制）
if (
  env.EXPECTED_FIREBASE_PROJECT_ID &&
  env.FIREBASE_PROJECT_ID &&
  env.EXPECTED_FIREBASE_PROJECT_ID !== env.FIREBASE_PROJECT_ID
) {
  errors.push(
    `FIREBASE_PROJECT_ID="${env.FIREBASE_PROJECT_ID}" が ` +
      `EXPECTED_FIREBASE_PROJECT_ID="${env.EXPECTED_FIREBASE_PROJECT_ID}" と一致しません（環境取り違えの可能性）`
  );
}

// 本番固有: demo 値混入の検出
if (appEnv === "production") {
  if (looksNonProdUrl(env.NEXT_PUBLIC_PORTAL_URL || "")) {
    errors.push(
      `NEXT_PUBLIC_PORTAL_URL="${env.NEXT_PUBLIC_PORTAL_URL || ""}" が本番ドメインではありません（demo値の混入疑い）`
    );
  }
  if (!env.CRON_SECRET) {
    errors.push("CRON_SECRET が未設定です（本番 Cron 認証に必須）");
  }
  // 審査用バイパスが本番で有効になっていないか
  if (env.ALLOW_REVIEW_MODE === "true") {
    errors.push("ALLOW_REVIEW_MODE=true は本番では無効化してください");
  }
  // 簡易パスワードログイン（dev/staging 専用）が本番に紛れていないか
  if (env.ADMIN_SIMPLE_PASSWORD) {
    errors.push(
      "ADMIN_SIMPLE_PASSWORD は本番では設定しないでください（dev/staging 専用のパスワードログイン）"
    );
  }
  // Dev ログイン（dev/staging 専用・LINE切り離し）が本番に紛れていないか
  if (["on", "1", "true", "yes"].includes((env.NEXT_PUBLIC_DEV_LOGIN || "").toLowerCase())) {
    errors.push(
      `NEXT_PUBLIC_DEV_LOGIN="${env.NEXT_PUBLIC_DEV_LOGIN}" は本番では無効化してください（dev/staging 専用の Dev ログイン）`
    );
  }
}

// ── 結果出力 ──
const label = `[check-env] APP_ENV=${appEnv}`;
for (const w of warnings) console.warn(`${label} ⚠ ${w}`);

if (errors.length > 0) {
  for (const e of errors) console.error(`${label} ✖ ${e}`);
  console.error(
    `\n[check-env] ${errors.length} 件の問題でビルドを中止しました。環境変数を確認してください。`
  );
  process.exit(1);
}

console.log(`${label} ✓ 環境変数チェック OK（warnings: ${warnings.length}）`);
