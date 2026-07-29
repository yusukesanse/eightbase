/**
 * 単体テスト: ひらがな↔カタカナを吸収した部分一致（同伴者ピッカーの予測変換で使う）
 */
import { toKatakana, toHiragana, kanaIncludes } from "@/lib/kana";

describe("kana", () => {
  test("toKatakana / toHiragana は相互に変換する", () => {
    expect(toKatakana("やまだ")).toBe("ヤマダ");
    expect(toHiragana("ヤマダ")).toBe("やまだ");
    // かな以外は素通り
    expect(toKatakana("山田 Taro")).toBe("山田 Taro");
    expect(toHiragana("山田 Taro")).toBe("山田 Taro");
  });

  test("ひらがなのクエリでカタカナ表記にヒットする", () => {
    expect(kanaIncludes("ヤマダタロウ", "やまだ")).toBe(true);
  });

  test("カタカナのクエリでひらがな表記にヒットする", () => {
    expect(kanaIncludes("やまだたろう", "ヤマダ")).toBe(true);
  });

  test("同じかな種どうしもヒットする", () => {
    expect(kanaIncludes("やまだたろう", "たろう")).toBe(true);
    expect(kanaIncludes("ヤマダタロウ", "タロウ")).toBe(true);
  });

  test("英字は大文字小文字を区別しない", () => {
    expect(kanaIncludes("Yamada Taro", "yamada")).toBe(true);
    expect(kanaIncludes("yamada taro", "TARO")).toBe(true);
  });

  test("一致しないものは false", () => {
    expect(kanaIncludes("やまだたろう", "すずき")).toBe(false);
  });

  test("空クエリは常にヒット（呼び出し側で空入力を弾く前提）", () => {
    expect(kanaIncludes("やまだ", "")).toBe(true);
  });

  test("target が空文字/未設定でも例外にならない", () => {
    expect(kanaIncludes("", "やま")).toBe(false);
    expect(kanaIncludes(undefined as unknown as string, "やま")).toBe(false);
  });
});
