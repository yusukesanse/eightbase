/**
 * シンプルなインメモリ・レートリミッター
 * Vercel のサーバーレス環境では再起動のたびにリセットされるが、
 * 1インスタンス内での短期的なブルートフォース攻撃を防止するには十分。
 *
 * 本格的なレートリミット（複数インスタンス対応）が必要な場合は
 * Vercel KV (Upstash Redis) への移行を推奨。
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// 1分おきに古いエントリを削除（メモリリーク防止）
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of Array.from(store.entries())) {
      if (now > entry.resetAt) store.delete(key);
    }
  }, 60_000);
}

/**
 * レートリミットを確認する。
 * @param key      識別キー（IPアドレスなど）
 * @param max      ウィンドウ内の最大リクエスト数
 * @param windowMs ウィンドウのミリ秒数
 * @returns true = OK, false = レートリミット超過
 */
export function checkRateLimit(
  key: string,
  max: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= max) return false;

  entry.count++;
  return true;
}

/**
 * IP アドレスを NextRequest から取得する。
 * Vercel では x-forwarded-for ヘッダーに実 IP が入る。
 */
export function getClientIp(req: Request): string {
  const forwarded = (req.headers as Headers).get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
}
