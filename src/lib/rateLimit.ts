/**
 * レートリミッタ。
 *
 * 既定は **インメモリ実装**（`InMemoryRateLimitStore`）。Vercel のサーバーレス環境では
 * インスタンスごと・再起動ごとにリセットされるため、複数インスタンスをまたぐ本格的な
 * ブルートフォース対策には不十分。将来 Vercel KV(Upstash Redis) / Firestore など
 * **共有ストア**へ差し替えられるよう、実装は `RateLimitStore` インターフェースに分離してある
 * （差し替え時は `setRateLimitStore()` で注入するだけでよい。呼び出し側は無変更）。
 *
 * ※ 共有ストア実装は非同期になる可能性があるが、現行の同期APIを壊さないため、
 *   まずはインメモリ同期実装で提供する。共有ストア導入時は本ファイルのAPIを
 *   Promise ベースへ拡張し、呼び出し側を await する。
 */

/**
 * レートリミットの永続化を担う抽象ストア。
 * 実装を差し替えることで in-memory / Redis / Firestore を切り替えられる。
 */
export interface RateLimitStore {
  /**
   * `key` のカウンタを1増やし、`windowMs` 内で `max` を超えていなければ true。
   * 超過していれば false（カウンタは増やさない）。
   */
  hit(key: string, max: number, windowMs: number): boolean;
  /** `key` の失敗を1回記録する（`windowMs` の失効窓つき）。現在の失敗回数を返す。 */
  recordFailure(key: string, windowMs: number): number;
  /** `key` の現在の失敗回数（失効分は 0）。 */
  failureCount(key: string): number;
  /** `key`（カウンタ・失敗の両方）を消す。成功時のリセット等に使う。 */
  reset(key: string): void;
}

interface Entry {
  count: number;
  resetAt: number;
}

/**
 * 既定のインメモリ実装。カウンタと失敗回数を別 namespace（`c:` / `f:`）で保持する。
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private store = new Map<string, Entry>();

  constructor() {
    // 古いエントリを定期的に削除（メモリリーク防止）
    if (typeof setInterval !== "undefined") {
      const timer = setInterval(() => this.sweep(), 60_000);
      // Node ではプロセス終了を妨げないようにする（存在する場合のみ）
      (timer as { unref?: () => void })?.unref?.();
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of Array.from(this.store.entries())) {
      if (now > entry.resetAt) this.store.delete(key);
    }
  }

  hit(key: string, max: number, windowMs: number): boolean {
    const k = `c:${key}`;
    const now = Date.now();
    const entry = this.store.get(k);
    if (!entry || now > entry.resetAt) {
      this.store.set(k, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (entry.count >= max) return false;
    entry.count++;
    return true;
  }

  recordFailure(key: string, windowMs: number): number {
    const k = `f:${key}`;
    const now = Date.now();
    const entry = this.store.get(k);
    if (!entry || now > entry.resetAt) {
      this.store.set(k, { count: 1, resetAt: now + windowMs });
      return 1;
    }
    entry.count++;
    return entry.count;
  }

  failureCount(key: string): number {
    const entry = this.store.get(`f:${key}`);
    if (!entry || Date.now() > entry.resetAt) return 0;
    return entry.count;
  }

  reset(key: string): void {
    this.store.delete(`c:${key}`);
    this.store.delete(`f:${key}`);
  }
}

/** 現在有効なストア（差し替え可能）。 */
let activeStore: RateLimitStore = new InMemoryRateLimitStore();

/** ストアを差し替える（例: Redis/Firestore 実装を注入）。 */
export function setRateLimitStore(store: RateLimitStore): void {
  activeStore = store;
}

/**
 * レートリミットを確認する（後方互換の関数API）。
 * @returns true = OK, false = レートリミット超過
 */
export function checkRateLimit(
  key: string,
  max: number,
  windowMs: number
): boolean {
  return activeStore.hit(key, max, windowMs);
}

/** 失敗を1回記録し、現在の失敗回数を返す。 */
export function recordFailure(key: string, windowMs: number): number {
  return activeStore.recordFailure(key, windowMs);
}

/** `key` の失敗回数が `maxFailures` 以上なら true（＝一時的に拒否すべき）。 */
export function isBlockedByFailures(key: string, maxFailures: number): boolean {
  return activeStore.failureCount(key) >= maxFailures;
}

/** カウンタ・失敗回数をリセットする（成功時など）。 */
export function resetRateLimit(key: string): void {
  activeStore.reset(key);
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
