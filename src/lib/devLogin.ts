/**
 * Dev ログイン（LINE/LIFF を通さずに本番同一フローを検証するための抜け穴）用ヘルパー。
 *
 * 「Devトークン」を LINE アクセストークンの代わりに使い、サーバー側（`src/lib/lineAuth.ts`）で
 * 合成プロフィールに解決する。これにより /api/auth/liff-login・invite・guest-redeem・profile が
 * **実LINE無しでも本番と同一経路**で通る。
 *
 * ⚠️ 本ファイルはトークンの encode/parse（純粋関数）とクライアント用 localStorage ヘルパーのみ。
 *    有効/無効の最終判定は `isDevLoginEnabled()`（env.ts）で行い、**本番では常に無効**。
 */

export interface DevIdentity {
  userId: string;
  displayName: string;
  pictureUrl?: string;
}

/** Devトークンのプレフィックス（実 LINE トークンと衝突しない値）。 */
const PREFIX = "dev.";

/**
 * Devトークンを生成する。
 * 形式: `dev.` + encodeURIComponent(JSON)（UTF-8安全・ブラウザ/Node双方で decode 可能）。
 */
export function buildDevToken(id: DevIdentity): string {
  const payload = {
    userId: id.userId,
    displayName: id.displayName ?? "",
    pictureUrl: id.pictureUrl ?? "",
  };
  return PREFIX + encodeURIComponent(JSON.stringify(payload));
}

/** 文字列が Devトークン形式か。 */
export function isDevToken(token: unknown): token is string {
  return typeof token === "string" && token.startsWith(PREFIX);
}

/** Devトークンを DevIdentity に復元する。不正なら null。 */
export function parseDevToken(token: string): DevIdentity | null {
  if (!isDevToken(token)) return null;
  try {
    const obj = JSON.parse(decodeURIComponent(token.slice(PREFIX.length)));
    if (!obj || typeof obj.userId !== "string" || !obj.userId) return null;
    return {
      userId: obj.userId,
      displayName: typeof obj.displayName === "string" ? obj.displayName : "",
      pictureUrl: typeof obj.pictureUrl === "string" ? obj.pictureUrl : "",
    };
  } catch {
    return null;
  }
}

/* ───────── クライアント用: 選択中のテストユーザーを保持 ───────── */

const STORAGE_KEY = "eb_dev_identity";

/** localStorage から選択中のテストユーザーを取得（未設定/サーバーでは null）。 */
export function getStoredDevIdentity(): DevIdentity | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return o && typeof o.userId === "string" && o.userId ? (o as DevIdentity) : null;
  } catch {
    return null;
  }
}

export function setStoredDevIdentity(id: DevIdentity): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(id));
  } catch {
    /* 無視 */
  }
}

export function clearStoredDevIdentity(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* 無視 */
  }
}
