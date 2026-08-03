/**
 * 参加費 Square 決済の「戻り先」の単一の真実。
 *
 * ■ なぜこのファイルがあるか（2026-08-03 本番障害の再発防止）
 *   ゲストが参加費を払ったのに当日「未払い」のままゲームに参加できない障害が起きた。
 *   原因は決済の戻り先が **会員専用ルートの `/info`** だったこと:
 *     1. Square が `/info?dartspay=<entryId>` へ戻す
 *     2. `AuthGuard` が role=guest を弾き `router.replace("/games")` する
 *        → **クエリ文字列ごと消える**
 *     3. `?dartspay=` を読む確定処理が動かず `/api/{game}/entries/complete` が呼ばれない
 *     4. エントリーは `paymentStatus: "pending"` のまま＝当日名簿で未払い扱い
 *   会員は `/info` に入れるため転送が成功し、**ゲストだけ**が壊れた。
 *
 * ■ 決めごと
 *   - 戻り先は必ず {@link GAME_PAYMENT_RETURN_BASE}（`/games`）。
 *     **全ロール（ゲスト含む）が入れる唯一の共通導線**なので、ロールで壊れない。
 *   - パラメータ名 ↔ 種目の対応をここ以外に書かない。
 *     以前は pay ルート4本・`GamesHub`・`/info` の3箇所に散っていて、
 *     「どのロールがどのパスに入れるか」と噛み合っているか誰も検証できなかった。
 */

import type { ScoreboardGameId } from "@/types";

/** 決済戻りパラメータ ↔ 種目。ここが唯一の定義。 */
export const PAYMENT_RETURN_PARAMS = {
  mjpay: "mahjong",
  dartspay: "darts",
  billiardspay: "billiards",
  pokerpay: "poker",
} as const satisfies Record<string, ScoreboardGameId>;

export type PaymentReturnParam = keyof typeof PAYMENT_RETURN_PARAMS;

export const PAYMENT_RETURN_PARAM_NAMES = Object.keys(PAYMENT_RETURN_PARAMS) as PaymentReturnParam[];

/**
 * 決済後に戻すパス。**会員専用ルートにしないこと**（ゲストが弾かれて確定処理が飛ぶ）。
 * `AuthGuard.isGuestAllowedPath` が許可するプレフィックスと一致している必要がある。
 */
export const GAME_PAYMENT_RETURN_BASE = "/games";

/** 種目 → 決済戻りパラメータ名。 */
export function paymentReturnParamFor(game: ScoreboardGameId): PaymentReturnParam {
  const found = PAYMENT_RETURN_PARAM_NAMES.find((p) => PAYMENT_RETURN_PARAMS[p] === game);
  if (!found) throw new Error(`決済戻りパラメータが未定義の種目です: ${game}`);
  return found;
}

/**
 * Square に渡す戻り先パス（例: `/games?dartspay=abc123`）。
 * pay ルートはこれを使い、パスを直書きしない。
 */
export function gamePaymentReturnPath(game: ScoreboardGameId, entryId: string): string {
  return `${GAME_PAYMENT_RETURN_BASE}?${paymentReturnParamFor(game)}=${encodeURIComponent(entryId)}`;
}

/**
 * URL のクエリから決済戻りを検出する。無ければ null。
 * `search` は `?a=b` でも `a=b` でも可。
 */
export function findPaymentReturn(
  search: string
): { param: PaymentReturnParam; game: ScoreboardGameId; entryId: string } | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  for (const param of PAYMENT_RETURN_PARAM_NAMES) {
    const entryId = params.get(param);
    if (entryId) return { param, game: PAYMENT_RETURN_PARAMS[param], entryId };
  }
  return null;
}

/**
 * 決済戻りパラメータ**だけ**を引き継いだクエリ文字列を返す（無ければ空文字）。
 *
 * ロール制限でリダイレクトするときに使う。既知のパラメータだけを通すので、
 * 会員専用ルート由来の他のクエリを意図せず持ち回らない。
 */
export function paymentReturnSearch(search: string): string {
  const found = findPaymentReturn(search);
  return found ? `?${found.param}=${encodeURIComponent(found.entryId)}` : "";
}
