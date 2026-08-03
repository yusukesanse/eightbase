/**
 * 単体テスト: src/lib/gamePaymentReturn.ts
 *
 * 背景（2026-08-03 本番障害）:
 *   ゲストが参加費を払ったのに当日「未払い」でゲームに参加できなかった。
 *   決済の戻り先が**会員専用ルート `/info`** だったため、role=guest は AuthGuard に弾かれ
 *   `router.replace("/games")` でクエリごと消え、`?dartspay=` を読む確定処理が動かなかった。
 *   会員は `/info` に入れるので転送が成功し、ゲストだけが壊れていた。
 *
 * ここで固定するのは「戻り先がゲストの許可パスであること」と
 * 「リダイレクトで決済パラメータを落とさないこと」。
 */
import {
  PAYMENT_RETURN_PARAMS,
  PAYMENT_RETURN_PARAM_NAMES,
  GAME_PAYMENT_RETURN_BASE,
  gamePaymentReturnPath,
  paymentReturnParamFor,
  findPaymentReturn,
  paymentReturnSearch,
} from "@/lib/gamePaymentReturn";

/** AuthGuard.isGuestAllowedPath と同じ判定（ここがズレると本障害が再発する）。 */
const isGuestAllowedPath = (pathname: string) => pathname.startsWith(GAME_PAYMENT_RETURN_BASE);

const GAMES = ["mahjong", "darts", "billiards", "poker"] as const;

describe("決済の戻り先は全ロール（ゲスト含む）が入れるパスであること", () => {
  test.each(GAMES)("%s の戻り先はゲストの許可パス配下", (game) => {
    const path = gamePaymentReturnPath(game, "entry123");
    const pathname = path.split("?")[0];
    expect(isGuestAllowedPath(pathname)).toBe(true);
  });

  test("戻り先に会員専用ルート(/info)を使っていない", () => {
    for (const game of GAMES) {
      expect(gamePaymentReturnPath(game, "e1").startsWith("/info")).toBe(false);
    }
    expect(GAME_PAYMENT_RETURN_BASE).toBe("/games");
  });

  test("戻り先パスは種目ごとのパラメータ＋エントリーIDを含む", () => {
    expect(gamePaymentReturnPath("darts", "abc123")).toBe("/games?dartspay=abc123");
    expect(gamePaymentReturnPath("mahjong", "xyz")).toBe("/games?mjpay=xyz");
    expect(gamePaymentReturnPath("billiards", "b1")).toBe("/games?billiardspay=b1");
    expect(gamePaymentReturnPath("poker", "p1")).toBe("/games?pokerpay=p1");
  });

  test("エントリーIDはURLエンコードする", () => {
    expect(gamePaymentReturnPath("darts", "a b&c")).toBe("/games?dartspay=a%20b%26c");
  });
});

describe("パラメータ ↔ 種目の対応（定義はこのファイルが唯一）", () => {
  test("4種目すべてに戻りパラメータがある", () => {
    expect(PAYMENT_RETURN_PARAM_NAMES.sort()).toEqual(["billiardspay", "dartspay", "mjpay", "pokerpay"]);
    for (const game of GAMES) expect(PAYMENT_RETURN_PARAMS[paymentReturnParamFor(game)]).toBe(game);
  });
});

describe("findPaymentReturn", () => {
  test("種目・パラメータ・エントリーIDを取り出す", () => {
    expect(findPaymentReturn("?dartspay=e1")).toEqual({ param: "dartspay", game: "darts", entryId: "e1" });
    expect(findPaymentReturn("pokerpay=e2")).toEqual({ param: "pokerpay", game: "poker", entryId: "e2" });
  });

  test("他のクエリが混ざっていても拾う", () => {
    expect(findPaymentReturn("?foo=1&mjpay=e3&bar=2")?.game).toBe("mahjong");
  });

  test("決済パラメータが無ければ null", () => {
    expect(findPaymentReturn("")).toBeNull();
    expect(findPaymentReturn("?tab=news")).toBeNull();
    expect(findPaymentReturn("?dartspay=")).toBeNull(); // 空値は戻りとみなさない
  });
});

describe("paymentReturnSearch（ロール制限リダイレクトでの引き継ぎ）", () => {
  test("ゲストが /info?dartspay= に戻されても /games へパラメータを引き継げる", () => {
    // これが空文字に戻ると本障害が再発する（払ったのに未払いのまま）。
    const search = paymentReturnSearch("?dartspay=entry-1");
    expect(search).toBe("?dartspay=entry-1");
    expect(`${GAME_PAYMENT_RETURN_BASE}${search}`).toBe("/games?dartspay=entry-1");
  });

  test("決済に無関係なクエリは引き継がない（会員専用ルート由来の値を持ち回らない）", () => {
    expect(paymentReturnSearch("?tab=timeline&postId=secret")).toBe("");
    expect(paymentReturnSearch("?mjpay=e1&tab=timeline")).toBe("?mjpay=e1");
  });

  test("空クエリは空文字", () => {
    expect(paymentReturnSearch("")).toBe("");
  });
});
