/**
 * 単体テスト: src/lib/lineAuth.ts
 * - getExpectedLineChannelIds: 想定チャネルID（LIFF ID プレフィックス / 明示env）の導出
 * - verifyLineAccessToken: client_id（発行元チャネル）検証を含むトークン検証
 */
import {
  getExpectedLineChannelIds,
  verifyLineAccessToken,
} from "@/lib/lineAuth";

const ENV_KEYS = [
  "LINE_LOGIN_CHANNEL_ID",
  "NEXT_PUBLIC_LIFF_ID",
  "NEXT_PUBLIC_LIFF_ID_REVIEW",
  "NEXT_PUBLIC_LIFF_ID_PROD",
] as const;

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  jest.restoreAllMocks();
});

/** verify エンドポイントの応答をモックする。 */
function mockVerify(body: unknown, ok = true) {
  jest.spyOn(global, "fetch").mockResolvedValue({
    ok,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);
}

describe("getExpectedLineChannelIds — 想定チャネルID導出", () => {
  test("明示 env(LINE_LOGIN_CHANNEL_ID) を最優先し、カンマ区切りで複数取れる", () => {
    process.env.LINE_LOGIN_CHANNEL_ID = "111, 222";
    process.env.NEXT_PUBLIC_LIFF_ID = "999-abc"; // 明示があるので無視される
    const ids = getExpectedLineChannelIds();
    expect(ids).toEqual(new Set(["111", "222"]));
  });

  test("明示 env が無ければ各 LIFF ID のハイフン前プレフィックスから導出する", () => {
    process.env.NEXT_PUBLIC_LIFF_ID = "1001-dev";
    process.env.NEXT_PUBLIC_LIFF_ID_REVIEW = "1002-review";
    process.env.NEXT_PUBLIC_LIFF_ID_PROD = "1003-prod";
    const ids = getExpectedLineChannelIds();
    expect(ids).toEqual(new Set(["1001", "1002", "1003"]));
  });

  test("何も設定が無ければ空集合", () => {
    expect(getExpectedLineChannelIds().size).toBe(0);
  });
});

describe("verifyLineAccessToken — client_id 検証", () => {
  test("client_id が想定チャネルと一致すれば valid", async () => {
    process.env.LINE_LOGIN_CHANNEL_ID = "12345";
    mockVerify({ expires_in: 3600, client_id: "12345" });
    expect(await verifyLineAccessToken("tok")).toBe("valid");
  });

  test("client_id が想定チャネルと一致しなければ invalid（不正チャネルのトークン拒否）", async () => {
    process.env.LINE_LOGIN_CHANNEL_ID = "12345";
    mockVerify({ expires_in: 3600, client_id: "99999" });
    expect(await verifyLineAccessToken("tok")).toBe("invalid");
  });

  test("LIFF ID プレフィックスと一致すれば valid", async () => {
    process.env.NEXT_PUBLIC_LIFF_ID_PROD = "20240001-xyz";
    mockVerify({ expires_in: 3600, client_id: "20240001" });
    expect(await verifyLineAccessToken("tok")).toBe("valid");
  });

  test("有効期限切れ(expires_in<=0)は expired（client_id より先に判定）", async () => {
    process.env.LINE_LOGIN_CHANNEL_ID = "12345";
    mockVerify({ expires_in: 0, client_id: "99999" });
    expect(await verifyLineAccessToken("tok")).toBe("expired");
  });

  test("想定チャネル未設定なら client_id 検証をスキップして valid（fail-open）", async () => {
    // env 一切なし → expected は空集合
    mockVerify({ expires_in: 3600, client_id: "anything" });
    expect(await verifyLineAccessToken("tok")).toBe("valid");
  });

  test("verify が失敗(ok=false)なら invalid", async () => {
    process.env.LINE_LOGIN_CHANNEL_ID = "12345";
    mockVerify({ error: "invalid_token" }, false);
    expect(await verifyLineAccessToken("tok")).toBe("invalid");
  });
});
