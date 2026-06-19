/**
 * portal のデータ取得 UX 改善用の小さな stale-while-revalidate キャッシュ helper。
 *
 * 方針:
 *   - 「前回値があれば即表示 → 裏で再取得 → 差し替え」を共通化するための土台。
 *   - フレームワーク非依存の薄い read/write のみ。React からは useStaleWhileRevalidate を使う。
 *   - timelineCache.ts と同じく例外は握りつぶし、SSR セーフにする。
 *
 * ─────────────────────────────────────────────────────────────────
 * storage は sessionStorage を既定にする（理由）:
 *   本アプリは LINE ミニアプリで、共有端末やアカウント切替の可能性がある。
 *   ログインを跨いで個人データが残ると「他人のデータが見える / 古い表示」になり
 *   情報漏えい・誤表示のリスクになるため、タブ/セッション終了で必ず消える
 *   sessionStorage を安全側の既定とする。
 *   localStorage は「ユーザーを跨いでも問題ない参照系（施設マスタ等）」に限り、
 *   呼び出し側が storage: "local" を明示的に指定したときだけ使う。
 *
 * ⚠️ 使ってはいけない用途:
 *   - 認証・セッション状態（/api/auth/check 等）… 常に最新が必要。古い値で誤認証になる。
 *   - 予約の空き状況 … 古い空き表示はダブルブッキングの原因になる。必ず都度取得する。
 *   - 決済・残高・金額計算 … 古い金額表示は事故。キャッシュ禁止。
 *   これらは従来どおり cache: "no-store" の都度 fetch を使うこと。
 * ─────────────────────────────────────────────────────────────────
 */

export type CacheStorageKind = "session" | "local";

interface CacheEnvelope<T> {
  data: T;
  /** 保存時刻（ms epoch）。鮮度判定に使う。 */
  ts: number;
}

export interface CacheReadResult<T> {
  data: T;
  ts: number;
  /** TTL を超過しているか（超過していても古い値として返す）。 */
  isStale: boolean;
}

/** キーに TTL 指定が無い場合の既定（60秒）。 */
export const DEFAULT_TTL = 60_000;

/**
 * キーの名前空間（":" の前）ごとの TTL（ミリ秒）。
 * ここに無い名前空間は DEFAULT_TTL を使う。更新頻度が低い参照系のみを想定する。
 * 例: "members:list", "members:123" は名前空間 "members"。
 */
export const CACHE_TTL: Record<string, number> = {
  members: 5 * 60_000, // メンバー一覧/プロフィールは頻繁には変わらない
  facilities: 10 * 60_000, // 施設マスタはほぼ静的
  timeline: 30_000, // 掲示板は短め
  news: 3 * 60_000, // ニュースは数分程度キャッシュしてよい
  events: 3 * 60_000, // イベント一覧も数分程度（予約の空き状況とは別物）
  // 予約の空き状況は事故防止のため極短時間のみ。前回表示を即出ししつつ常に裏で
  // 取り直し、「更新中」を表示する。最終的な整合性はサーバー(予約確定時)が担保する。
  avail: 30_000,
};

/** キー（"namespace:..."）から TTL を解決する。 */
export function ttlForKey(key: string): number {
  const ns = key.split(":")[0];
  return CACHE_TTL[ns] ?? DEFAULT_TTL;
}

function getStore(kind: CacheStorageKind): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function storageKey(key: string): string {
  return `swr:${key}`;
}

/**
 * キャッシュを読み出す。TTL 超過していても古い値として返し、isStale=true を立てる。
 * （stale-while-revalidate のため、古くても一旦は表示できるようにする。）
 */
export function readCache<T>(
  key: string,
  options?: { storage?: CacheStorageKind; ttl?: number }
): CacheReadResult<T> | null {
  const store = getStore(options?.storage ?? "session");
  if (!store) return null;
  try {
    const raw = store.getItem(storageKey(key));
    if (!raw) return null;
    const env = JSON.parse(raw) as CacheEnvelope<T>;
    if (!env || typeof env.ts !== "number") return null;
    const ttl = options?.ttl ?? ttlForKey(key);
    return {
      data: env.data,
      ts: env.ts,
      isStale: Date.now() - env.ts > ttl,
    };
  } catch {
    return null;
  }
}

/** キャッシュへ保存する（保存時刻を一緒に持つ）。 */
export function writeCache<T>(
  key: string,
  data: T,
  options?: { storage?: CacheStorageKind }
): void {
  const store = getStore(options?.storage ?? "session");
  if (!store) return;
  try {
    const env: CacheEnvelope<T> = { data, ts: Date.now() };
    store.setItem(storageKey(key), JSON.stringify(env));
  } catch {
    // quota 超過などは無視（キャッシュは無くても動く前提）
  }
}

/** 特定キーのキャッシュを破棄する。 */
export function clearCache(
  key: string,
  options?: { storage?: CacheStorageKind }
): void {
  const store = getStore(options?.storage ?? "session");
  if (!store) return;
  try {
    store.removeItem(storageKey(key));
  } catch {
    // 無視
  }
}

/**
 * このキャッシュ機構（swr: プレフィックス）で保存した全データを session/local
 * 両方から破棄する。ログイン/ログアウトでユーザーが切り替わるときに呼び、
 * 別ユーザーの表示キャッシュ（メンバー一覧・マイページ等）が残らないようにする。
 * キャッシュの所有者マーカー（OWNER_KEY）も併せて消す。
 */
export function clearAllCache(): void {
  if (typeof window === "undefined") return;
  for (const kind of ["session", "local"] as CacheStorageKind[]) {
    const store = getStore(kind);
    if (!store) continue;
    try {
      const keys: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k && (k.startsWith("swr:") || k === OWNER_KEY)) keys.push(k);
      }
      keys.forEach((k) => store.removeItem(k));
    } catch {
      // 無視
    }
  }
}

/**
 * キャッシュの「所有者」= 現在キャッシュを書いたユーザーの lineUserId を記録する。
 * AuthGuard が認証チェック時に現在ユーザーと突き合わせ、違っていれば前ユーザーの
 * 表示キャッシュを破棄するために使う（ユーザーID変更検知）。
 * swr: プレフィックスは付けない（clearAllCache の対象だが、別途明示的に消す）。
 */
const OWNER_KEY = "portalCacheOwner";

export function getCacheOwner(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

export function setCacheOwner(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(OWNER_KEY, userId);
  } catch {
    // 無視
  }
}
