/**
 * 単体テスト: src/lib/square.ts assertSquarePaymentValid
 * 取得済み payment の検証ロジック（完了・金額一致・JPY）。Square API は呼ばない。
 */
import { assertSquarePaymentValid } from "@/lib/square";

function payment(over: Record<string, unknown> = {}) {
  return {
    status: "COMPLETED",
    amountMoney: { amount: BigInt(22000), currency: "JPY" },
    ...over,
  };
}

describe("assertSquarePaymentValid", () => {
  test("完了済み・金額一致・JPY なら通る（amount=bigint）", () => {
    expect(() => assertSquarePaymentValid(payment(), 22000)).not.toThrow();
  });

  test("amount が number でも一致すれば通る", () => {
    expect(() =>
      assertSquarePaymentValid(payment({ amountMoney: { amount: 22000, currency: "JPY" } }), 22000)
    ).not.toThrow();
  });

  test("payment が null/undefined はエラー", () => {
    expect(() => assertSquarePaymentValid(null, 22000)).toThrow();
    expect(() => assertSquarePaymentValid(undefined, 22000)).toThrow();
  });

  test("status が COMPLETED でないとエラー", () => {
    expect(() => assertSquarePaymentValid(payment({ status: "PENDING" }), 22000)).toThrow(/完了/);
    expect(() => assertSquarePaymentValid(payment({ status: "APPROVED" }), 22000)).toThrow();
  });

  test("金額不一致はエラー", () => {
    expect(() => assertSquarePaymentValid(payment(), 20000)).toThrow(/金額/);
    expect(() =>
      assertSquarePaymentValid(payment({ amountMoney: { amount: BigInt(21900), currency: "JPY" } }), 22000)
    ).toThrow(/金額/);
  });

  test("amount 欠落はエラー", () => {
    expect(() =>
      assertSquarePaymentValid(payment({ amountMoney: { amount: null, currency: "JPY" } }), 22000)
    ).toThrow();
  });

  test("通貨が JPY でないとエラー", () => {
    expect(() =>
      assertSquarePaymentValid(payment({ amountMoney: { amount: BigInt(22000), currency: "USD" } }), 22000)
    ).toThrow(/通貨/);
  });
});
