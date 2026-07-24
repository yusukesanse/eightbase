/**
 * 単体テスト: src/lib/eventComments.ts（イベントコメントの本文検証・連投判定）。
 */
import { validateCommentBody, isTooSoon, COMMENT_MAX_LENGTH, COMMENT_COOLDOWN_MS } from "@/lib/eventComments";

describe("validateCommentBody", () => {
  test("非文字列は不正", () => {
    expect(validateCommentBody(123)).toMatchObject({ ok: false });
    expect(validateCommentBody(null)).toMatchObject({ ok: false });
    expect(validateCommentBody(undefined)).toMatchObject({ ok: false });
  });

  test("空文字・空白のみは不正", () => {
    expect(validateCommentBody("")).toMatchObject({ ok: false });
    expect(validateCommentBody("   \n \t")).toMatchObject({ ok: false });
  });

  test("前後空白を除去して返す", () => {
    expect(validateCommentBody("  こんにちは  ")).toEqual({ ok: true, value: "こんにちは" });
  });

  test("文字数上限を超えると不正・境界は許可", () => {
    expect(validateCommentBody("あ".repeat(COMMENT_MAX_LENGTH))).toMatchObject({ ok: true });
    expect(validateCommentBody("あ".repeat(COMMENT_MAX_LENGTH + 1))).toMatchObject({ ok: false });
  });
});

describe("isTooSoon（連投判定）", () => {
  const now = 1_000_000_000_000;
  test("直近投稿なし（null）は許可", () => {
    expect(isTooSoon(null, now)).toBe(false);
  });
  test("COOLDOWN 未満は拒否", () => {
    expect(isTooSoon(new Date(now - (COMMENT_COOLDOWN_MS - 1)).toISOString(), now)).toBe(true);
  });
  test("COOLDOWN 以上は許可", () => {
    expect(isTooSoon(new Date(now - COMMENT_COOLDOWN_MS).toISOString(), now)).toBe(false);
    expect(isTooSoon(new Date(now - 60_000).toISOString(), now)).toBe(false);
  });
  test("不正な日付は許可（ブロックしない）", () => {
    expect(isTooSoon("not-a-date", now)).toBe(false);
  });
});
