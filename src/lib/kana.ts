/**
 * ひらがな↔カタカナを吸収した部分一致。
 *
 * 日本語の氏名検索では利用者が「やまだ」と打っても「ヤマダ」と打っても同じ人に当てたい。
 * IME の変換途中（ひらがな）でも候補が出るようにするため、クエリを両方のかなに展開して照合する。
 * メンバー一覧の検索窓と、予約の同伴者ピッカーの予測変換で共用する。
 */

/** ひらがな → カタカナ（0x60 のオフセットで対応する Unicode 面に移す） */
export function toKatakana(s: string): string {
  return s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

/** カタカナ → ひらがな */
export function toHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** target が query を含むか。大文字小文字とひらがな/カタカナの違いは無視する。 */
export function kanaIncludes(target: string, query: string): boolean {
  const t = (target || "").toLowerCase();
  const q = query.toLowerCase();
  return t.includes(q) || t.includes(toKatakana(q)) || t.includes(toHiragana(q));
}
