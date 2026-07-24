/**
 * 単体テスト: 施設ごとのSquare認証情報の暗号化保管（src/lib/facilitySecrets.ts）
 * - AES-256-GCM の往復・改ざん検知・鍵未設定時の挙動
 * - Firestore には暗号文のみ保存され、平文が残らないこと
 */
import crypto from "crypto";

// Firestore（facilitySecrets コレクション）のインメモリモック
const store = new Map<string, Record<string, unknown>>();
const mockDoc = (id: string) => ({
  set: jest.fn(async (data: Record<string, unknown>, opts?: { merge?: boolean }) => {
    const prev = opts?.merge ? (store.get(id) ?? {}) : {};
    store.set(id, { ...prev, ...data });
  }),
  get: jest.fn(async () => {
    const data = store.get(id);
    return { id, exists: !!data, data: () => data };
  }),
  delete: jest.fn(async () => {
    store.delete(id);
  }),
});
jest.mock("@/lib/firebaseAdmin", () => ({
  getDb: () => ({
    collection: () => ({ doc: (id: string) => mockDoc(id) }),
    getAll: async (...refs: Array<{ get: () => Promise<unknown> }>) =>
      Promise.all(refs.map((r) => r.get())),
  }),
}));

import {
  encryptSecret,
  decryptSecret,
  isSecretsKeyConfigured,
  saveFacilitySquareSecrets,
  getFacilitySquareCredentials,
  clearFacilitySquareSecrets,
  getFacilitySquareStatusMap,
} from "@/lib/facilitySecrets";

const TEST_KEY = crypto.randomBytes(32).toString("base64");

describe("facilitySecrets — 暗号化", () => {
  beforeEach(() => {
    process.env.FACILITY_SECRETS_KEY = TEST_KEY;
    store.clear();
  });
  afterAll(() => {
    delete process.env.FACILITY_SECRETS_KEY;
  });

  test("暗号化→復号で元の値に戻る", () => {
    const secret = "EAAAsuper-secret-square-token";
    const enc = encryptSecret(secret);
    expect(enc).not.toContain(secret);
    expect(decryptSecret(enc)).toBe(secret);
  });

  test("同じ平文でも毎回異なる暗号文になる（IVランダム）", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  test("改ざんされた暗号文は復号エラー", () => {
    const enc = encryptSecret("secret");
    const parts = enc.split(":");
    // ciphertext 先頭バイトを反転
    const ct = Buffer.from(parts[3], "base64");
    ct[0] = ct[0] ^ 0xff;
    parts[3] = ct.toString("base64");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });

  test("鍵未設定時: encryptSecret は明示エラー / isSecretsKeyConfigured は false", () => {
    delete process.env.FACILITY_SECRETS_KEY;
    expect(isSecretsKeyConfigured()).toBe(false);
    expect(() => encryptSecret("x")).toThrow(/FACILITY_SECRETS_KEY/);
  });

  test("鍵が32バイトでない場合は無効扱い", () => {
    process.env.FACILITY_SECRETS_KEY = Buffer.from("short").toString("base64");
    expect(isSecretsKeyConfigured()).toBe(false);
  });

  test("hex形式の32バイト鍵も受け付ける", () => {
    process.env.FACILITY_SECRETS_KEY = crypto.randomBytes(32).toString("hex");
    expect(isSecretsKeyConfigured()).toBe(true);
    expect(decryptSecret(encryptSecret("v"))).toBe("v");
  });
});

describe("facilitySecrets — 保存/取得", () => {
  beforeEach(() => {
    process.env.FACILITY_SECRETS_KEY = TEST_KEY;
    store.clear();
  });

  test("保存された値は暗号文のみ（平文がFirestoreに残らない）", async () => {
    await saveFacilitySquareSecrets("trailer", {
      accessToken: "EAAAtoken-plain",
      locationId: "LOCATION123ABCD",
      environment: "sandbox",
    });
    const raw = JSON.stringify(store.get("trailer"));
    expect(raw).not.toContain("EAAAtoken-plain");
    expect(raw).not.toContain("LOCATION123ABCD");
    // 下4桁メタデータのみ平文
    expect(store.get("trailer")?.squareLocationIdLast4).toBe("ABCD");
  });

  test("保存→取得で復号された認証情報が返る", async () => {
    await saveFacilitySquareSecrets("trailer", {
      accessToken: "EAAAtoken",
      locationId: "LOC1234",
      environment: "sandbox",
    });
    const creds = await getFacilitySquareCredentials("trailer");
    expect(creds).toEqual({
      accessToken: "EAAAtoken",
      locationId: "LOC1234",
      environment: "sandbox",
    });
  });

  test("部分更新: トークンだけ差し替えてもロケーションIDは維持される", async () => {
    await saveFacilitySquareSecrets("trailer", { accessToken: "old-token", locationId: "LOC1" });
    await saveFacilitySquareSecrets("trailer", { accessToken: "new-token" });
    const creds = await getFacilitySquareCredentials("trailer");
    expect(creds?.accessToken).toBe("new-token");
    expect(creds?.locationId).toBe("LOC1");
  });

  test("未登録の施設は null（環境変数フォールバックへ）", async () => {
    expect(await getFacilitySquareCredentials("nothing")).toBeNull();
  });

  test("トークン/ロケーションIDが揃っていなければ null", async () => {
    await saveFacilitySquareSecrets("half", { accessToken: "only-token" });
    expect(await getFacilitySquareCredentials("half")).toBeNull();
  });

  test("鍵未設定なら保存済みでも null（例外にしない）", async () => {
    await saveFacilitySquareSecrets("trailer", { accessToken: "t", locationId: "l" });
    delete process.env.FACILITY_SECRETS_KEY;
    expect(await getFacilitySquareCredentials("trailer")).toBeNull();
  });

  test("clear で削除される", async () => {
    await saveFacilitySquareSecrets("trailer", { accessToken: "t", locationId: "l" });
    await clearFacilitySquareSecrets("trailer");
    expect(await getFacilitySquareCredentials("trailer")).toBeNull();
  });

  test("statusMap は秘密値を含まない状態のみ返す", async () => {
    await saveFacilitySquareSecrets("trailer", {
      accessToken: "EAAAsecret",
      locationId: "LOCATION999WXYZ",
      environment: "production",
    });
    const map = await getFacilitySquareStatusMap(["trailer", "none"]);
    expect(map.trailer.configured).toBe(true);
    expect(map.trailer.locationIdLast4).toBe("WXYZ");
    expect(map.trailer.environment).toBe("production");
    expect(JSON.stringify(map)).not.toContain("EAAAsecret");
    expect(JSON.stringify(map)).not.toContain("LOCATION999");
    expect(map.none).toBeUndefined();
  });
});
