/**
 * 単体テスト: シーズン設定の正規化（src/lib/scoreboardSeason.ts）。
 */
import { sanitizeGameMasterIds, sanitizeSeasonMarkdown, SEASON_MARKDOWN_MAX } from "@/lib/scoreboardSeason";

describe("sanitizeGameMasterIds", () => {
  test("非配列は空配列", () => {
    expect(sanitizeGameMasterIds(undefined)).toEqual([]);
    expect(sanitizeGameMasterIds("u1")).toEqual([]);
  });
  test("空文字を除き、重複を潰し、前後の空白を落とす", () => {
    expect(sanitizeGameMasterIds([" u1 ", "u1", "", "  ", "u2", 5])).toEqual(["u1", "u2"]);
  });
});

describe("sanitizeSeasonMarkdown", () => {
  test("未設定・空文字は空文字（＝設定なし）", () => {
    expect(sanitizeSeasonMarkdown(undefined)).toBe("");
    expect(sanitizeSeasonMarkdown(null)).toBe("");
    expect(sanitizeSeasonMarkdown("")).toBe("");
  });

  test("文字列は trim して返す", () => {
    expect(sanitizeSeasonMarkdown("  ## ルール\n1. 半荘は4人打ち  ")).toBe("## ルール\n1. 半荘は4人打ち");
  });

  test("文字列以外は不正（null）", () => {
    expect(sanitizeSeasonMarkdown(42)).toBeNull();
    expect(sanitizeSeasonMarkdown({})).toBeNull();
  });

  test("上限ちょうどは通し、超えたら不正", () => {
    expect(sanitizeSeasonMarkdown("あ".repeat(SEASON_MARKDOWN_MAX))).toHaveLength(SEASON_MARKDOWN_MAX);
    expect(sanitizeSeasonMarkdown("あ".repeat(SEASON_MARKDOWN_MAX + 1))).toBeNull();
  });
});
