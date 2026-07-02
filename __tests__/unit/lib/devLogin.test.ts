/**
 * 単体テスト: src/lib/devLogin.ts
 * Devトークンの encode/parse（LINE切り離し検証用の合成トークン）。
 */
import { buildDevToken, isDevToken, parseDevToken } from "@/lib/devLogin";

describe("devLogin — Devトークン", () => {
  test("build→parse でラウンドトリップする", () => {
    const id = { userId: "dev-member-01", displayName: "会員テスト", pictureUrl: "https://x/y.png" };
    const token = buildDevToken(id);
    expect(isDevToken(token)).toBe(true);
    expect(parseDevToken(token)).toEqual(id);
  });

  test("日本語表示名も壊れない（UTF-8）", () => {
    const id = { userId: "U_test", displayName: "山田 太郎🀄", pictureUrl: "" };
    expect(parseDevToken(buildDevToken(id))).toEqual(id);
  });

  test("pictureUrl 省略時は空文字で復元", () => {
    const token = buildDevToken({ userId: "u1", displayName: "n" });
    expect(parseDevToken(token)).toEqual({ userId: "u1", displayName: "n", pictureUrl: "" });
  });

  test("非Devトークンは isDevToken=false / parse=null", () => {
    expect(isDevToken("eyJ.some.linetoken")).toBe(false);
    expect(parseDevToken("eyJ.some.linetoken")).toBeNull();
    expect(isDevToken("")).toBe(false);
  });

  test("dev.接頭辞でも中身が壊れていれば null", () => {
    expect(parseDevToken("dev.%%%not-json")).toBeNull();
    expect(parseDevToken("dev." + encodeURIComponent(JSON.stringify({ displayName: "no id" })))).toBeNull();
  });
});
