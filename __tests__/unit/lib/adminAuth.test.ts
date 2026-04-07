/**
 * 単体テスト: src/lib/adminAuth.ts
 * 管理者認証・JWT・CSRF・バリデーション・ホワイトリストのテスト
 */
import {
  signAdminToken,
  verifyAdminToken,
  validateFields,
  pickAllowedFields,
} from "@/lib/adminAuth";

/* ───────── JWT 署名・検証 ───────── */

describe("adminAuth — JWT署名・検証", () => {
  // UT-AUTH-001: 正常なJWT生成と検証
  test("signAdminToken で生成したトークンを verifyAdminToken で検証できる", async () => {
    const token = await signAdminToken("admin@example.com");
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3); // JWT format

    const result = await verifyAdminToken(token);
    expect(result).toBe("admin@example.com");
  });

  // UT-AUTH-002: 不正なトークンは拒否
  test("不正なトークンはnullを返す", async () => {
    expect(await verifyAdminToken("invalid-token")).toBeNull();
    expect(await verifyAdminToken("")).toBeNull();
    expect(await verifyAdminToken("a.b.c")).toBeNull();
  });

  // UT-AUTH-003: 改ざんされたトークンは拒否
  test("改ざんされたトークンはnullを返す", async () => {
    const token = await signAdminToken("admin@example.com");
    const tampered = token.slice(0, -5) + "XXXXX";
    expect(await verifyAdminToken(tampered)).toBeNull();
  });
});

/* ───────── バリデーション ───────── */

describe("adminAuth — validateFields", () => {
  // UT-VAL-001: 正常な入力はnullを返す
  test("正常な入力はnullを返す", () => {
    const result = validateFields(
      { title: "テストタイトル", description: "説明文" },
      {
        title: { type: "string", maxLength: 200 },
        description: { type: "string", maxLength: 5000 },
      }
    );
    expect(result).toBeNull();
  });

  // UT-VAL-002: maxLength超過
  test("maxLength超過でエラーメッセージを返す", () => {
    const result = validateFields(
      { title: "a".repeat(201) },
      { title: { type: "string", maxLength: 200 } }
    );
    expect(result).toContain("200文字以下");
  });

  // UT-VAL-003: minLength不足
  test("minLength不足でエラーメッセージを返す", () => {
    const result = validateFields(
      { title: "a" },
      { title: { type: "string", minLength: 2 } }
    );
    expect(result).toContain("2文字以上");
  });

  // UT-VAL-004: URL形式の検証
  test("不正なURLでエラーメッセージを返す", () => {
    const result = validateFields(
      { imageUrl: "not-a-url" },
      { imageUrl: { type: "url" } }
    );
    expect(result).toContain("有効なURL");
  });

  // UT-VAL-005: 正しいURLは通過
  test("正しいURLはnullを返す", () => {
    const result = validateFields(
      { imageUrl: "https://example.com/image.png" },
      { imageUrl: { type: "url" } }
    );
    expect(result).toBeNull();
  });

  // UT-VAL-006: 空のURLは通過（任意フィールド）
  test("空文字列のURLはバリデーション通過", () => {
    const result = validateFields(
      { imageUrl: "" },
      { imageUrl: { type: "url" } }
    );
    expect(result).toBeNull();
  });

  // UT-VAL-007: 数値バリデーション
  test("数値の範囲外でエラーを返す", () => {
    const result = validateFields(
      { requiredCount: 0 },
      { requiredCount: { type: "number", min: 1, max: 100000 } }
    );
    expect(result).toContain("1以上");
  });

  // UT-VAL-008: 数値の最大値超過
  test("数値の最大値超過でエラーを返す", () => {
    const result = validateFields(
      { rewardPoints: 1000001 },
      { rewardPoints: { type: "number", min: 0, max: 1000000 } }
    );
    expect(result).toContain("1000000以下");
  });

  // UT-VAL-009: 数値でない値
  test("数値でない値でエラーを返す", () => {
    const result = validateFields(
      { count: "abc" },
      { count: { type: "number" } }
    );
    expect(result).toContain("数値");
  });

  // UT-VAL-010: boolean型の検証
  test("boolean型以外でエラーを返す", () => {
    const result = validateFields(
      { published: "true" },
      { published: { type: "boolean" } }
    );
    expect(result).toContain("真偽値");
  });

  // UT-VAL-011: boolean型の正常値
  test("正しいboolean値はnullを返す", () => {
    const result = validateFields(
      { published: true },
      { published: { type: "boolean" } }
    );
    expect(result).toBeNull();
  });

  // UT-VAL-012: 未定義フィールドはスキップ
  test("未定義のフィールドはスキップされる", () => {
    const result = validateFields(
      {},
      { title: { type: "string", minLength: 1 } }
    );
    expect(result).toBeNull();
  });

  // UT-VAL-013: 文字列型に非文字列
  test("文字列型に数値を渡すとエラー", () => {
    const result = validateFields(
      { title: 123 },
      { title: { type: "string" } }
    );
    expect(result).toContain("文字列");
  });
});

/* ───────── フィールドホワイトリスト ───────── */

describe("adminAuth — pickAllowedFields", () => {
  // UT-WL-001: 許可フィールドのみ抽出
  test("許可されたフィールドのみ抽出する", () => {
    const data = { title: "テスト", description: "説明", secret: "漏洩" };
    const result = pickAllowedFields(data, ["title", "description"]);
    expect(result).toEqual({ title: "テスト", description: "説明" });
    expect(result).not.toHaveProperty("secret");
  });

  // UT-WL-002: 存在しないフィールドは無視
  test("データに存在しないフィールドは結果に含まれない", () => {
    const data = { title: "テスト" };
    const result = pickAllowedFields(data, ["title", "description"]);
    expect(result).toEqual({ title: "テスト" });
  });

  // UT-WL-003: 空のデータ
  test("空のデータからは空のオブジェクトが返る", () => {
    const result = pickAllowedFields({}, ["title", "description"]);
    expect(result).toEqual({});
  });

  // UT-WL-004: 空のホワイトリスト
  test("空のホワイトリストでは全フィールドが除外される", () => {
    const data = { title: "テスト", description: "説明" };
    const result = pickAllowedFields(data, []);
    expect(result).toEqual({});
  });

  // UT-WL-005: 値がnullやfalseでも抽出
  test("値がnull/false/0でも許可されていれば抽出する", () => {
    const data = { active: false, count: 0, note: null };
    const result = pickAllowedFields(data, ["active", "count", "note"]);
    expect(result).toEqual({ active: false, count: 0, note: null });
  });
});
